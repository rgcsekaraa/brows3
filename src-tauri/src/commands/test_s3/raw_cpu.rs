use super::*;
use std::ffi::{c_char, c_int, c_void, CString};
use std::os::unix::ffi::OsStrExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

// The shell launcher preloads gperftools only into this test process. Normal
// builds and tests have no link-time or runtime dependency on the profiler.
#[link(name = "dl")]
unsafe extern "C" {
    fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
}

#[repr(C)]
struct ProfilerOptions {
    filter_in_thread: extern "C" fn(*mut c_void) -> c_int,
    filter_in_thread_arg: *mut c_void,
}

static IN_WINDOW: AtomicBool = AtomicBool::new(false);

extern "C" fn include_sample(_: *mut c_void) -> c_int {
    // Called from SIGPROF. Only an atomic load is safe here.
    IN_WINDOW.load(Ordering::Relaxed).into()
}

fn begin_window() {
    IN_WINDOW.store(true, Ordering::Relaxed);
}

pub(super) fn end_window() {
    IN_WINDOW.store(false, Ordering::Relaxed);
}

struct Recording {
    stop: unsafe extern "C" fn(),
}

impl Recording {
    fn start(path: &Path) -> Self {
        let name = CString::new(path.as_os_str().as_bytes()).unwrap();
        let options = ProfilerOptions {
            filter_in_thread: include_sample,
            filter_in_thread_arg: std::ptr::null_mut(),
        };
        // These signatures and the options layout match gperftools/profiler.h.
        unsafe {
            let start = dlsym(std::ptr::null_mut(), c"ProfilerStartWithOptions".as_ptr());
            let stop = dlsym(std::ptr::null_mut(), c"ProfilerStop".as_ptr());
            assert!(
                !start.is_null() && !stop.is_null(),
                "run scripts/capture-encryption-profile.sh"
            );
            let start: unsafe extern "C" fn(*const c_char, *const ProfilerOptions) -> c_int =
                std::mem::transmute(start);
            assert_ne!(start(name.as_ptr(), &options), 0, "could not open profile");
            Self {
                stop: std::mem::transmute::<*mut c_void, unsafe extern "C" fn()>(stop),
            }
        }
    }
}

impl Drop for Recording {
    fn drop(&mut self) {
        end_window();
        unsafe { (self.stop)() };
    }
}

#[tokio::test]
#[ignore = "raw Linux CPU profile; use scripts/capture-encryption-profile.sh"]
async fn capture_cpu_before_wire() {
    let directory = std::path::PathBuf::from(std::env::var_os("BROWS3_CPU_PROFILE_DIR").unwrap());
    let stop = BeforeWire::default();
    let client = benchmark_client(stop.clone());
    let bucket = format!("b3e1-{}", "a".repeat(32));
    let secret = envelope::random_key().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    for (size, workload) in [(4096, "4kib"), (8 * 1024 * 1024, "8mib")] {
        std::fs::write(&source, vec![0x57; size]).unwrap();
        for (protected, mode) in [(false, "plain"), (true, "encrypted")] {
            let mut recording = None;
            let mut measured = Duration::ZERO;
            let mut count = 0;
            while measured < Duration::from_secs(3) {
                let start = if protected {
                    let (sender, receiver) = tokio::sync::oneshot::channel();
                    upload_with_start(
                        &client,
                        &bucket,
                        "object",
                        &source,
                        secret.clone(),
                        move || {
                            begin_window();
                            sender.send(Instant::now()).unwrap();
                        },
                    )
                    .await
                    .unwrap_err();
                    receiver.await.unwrap()
                } else {
                    crate::transfer::manager::transfer_profile::prepare_plain_upload(
                        &client,
                        &source,
                        size as u64,
                        begin_window,
                    )
                    .await
                };
                let end = stop.0.lock().unwrap().take().expect("expected signed PUT");
                if recording.is_some() {
                    measured += end - start;
                    count += 1;
                } else {
                    // Start after the initial warm-up has reached the same stop hook.
                    recording = Some(Recording::start(
                        &directory.join(format!("{workload}-{mode}.prof")),
                    ));
                }
            }
            drop(recording);
            println!("BROWS3_CPU {workload} {mode} {count} iterations");
        }
    }
}
