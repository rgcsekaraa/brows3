use aws_smithy_types::{body::SdkBody, byte_stream::ByteStream};
use http_body::Body;
use std::future::Future;
use std::{
    collections::VecDeque,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll},
    time::{Duration, Instant},
};

#[derive(Debug, Default)]
pub struct Progress {
    pub position: u64,
    pub attempt: u64,
    pub cancelled: bool,
    pub download_started: Option<tokio::time::Instant>,
    pub download_bytes: u64,
}

struct TrackedBody {
    inner: SdkBody,
    progress: Arc<Mutex<Progress>>,
    position: u64,
    started: bool,
    rate: u64,
    held: Option<http_body::Frame<<SdkBody as Body>::Data>>,
    sleep: Option<Pin<Box<tokio::time::Sleep>>>,
    pacing_started: Option<tokio::time::Instant>,
    pacing_bytes: u64,
}

impl Body for TrackedBody {
    type Data = <SdkBody as Body>::Data;
    type Error = <SdkBody as Body>::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<http_body::Frame<Self::Data>, Self::Error>>> {
        if self.progress.lock().unwrap().cancelled {
            return Poll::Ready(Some(Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "Transfer cancelled",
            )
            .into())));
        }
        if !self.started {
            self.started = true;
            self.pacing_started = Some(tokio::time::Instant::now());
            let mut progress = self.progress.lock().unwrap();
            if progress.position > self.position {
                progress.attempt += 1;
            }
            progress.position = self.position;
        }
        if let Some(sleep) = &mut self.sleep {
            if sleep.as_mut().poll(cx).is_pending() {
                return Poll::Pending;
            }
            self.sleep = None;
            let frame = self.held.take().expect("delayed frame");
            if let Some(data) = frame.data_ref() {
                self.position += data.len() as u64;
                self.progress.lock().unwrap().position = self.position;
            }
            return Poll::Ready(Some(Ok(frame)));
        }
        let result = Pin::new(&mut self.inner).poll_frame(cx);
        if self.rate > 0 {
            if let Poll::Ready(Some(Ok(frame))) = result {
                if let Some(data) = frame.data_ref() {
                    if !data.is_empty() {
                        self.pacing_bytes += data.len() as u64;
                        let deadline = self.pacing_started.expect("body started")
                            + super::controls::delay(self.pacing_bytes, self.rate);
                        self.sleep = Some(Box::pin(tokio::time::sleep_until(deadline)));
                        self.held = Some(frame);
                        return self.poll_frame(cx);
                    }
                }
                return Poll::Ready(Some(Ok(frame)));
            }
            return result;
        }
        if let Poll::Ready(Some(Ok(frame))) = &result {
            if let Some(data) = frame.data_ref() {
                self.position += data.len() as u64;
                self.progress.lock().unwrap().position = self.position;
            }
        }
        result
    }

    fn size_hint(&self) -> http_body::SizeHint {
        let mut hint = self.inner.size_hint();
        let held = self
            .held
            .as_ref()
            .and_then(|f| f.data_ref())
            .map_or(0, |d| d.len() as u64);
        if let Some(exact) = hint.exact() {
            hint.set_exact(exact + held);
        }
        hint
    }
    fn is_end_stream(&self) -> bool {
        self.held.is_none() && self.inner.is_end_stream()
    }
}

// Mapping preserves retryability, content length, checksums and the original bytes.
#[cfg(test)]
pub fn track(body: ByteStream, progress: Arc<Mutex<Progress>>, offset: u64) -> ByteStream {
    track_limited(body, progress, offset, 0)
}

pub fn track_limited(
    body: ByteStream,
    progress: Arc<Mutex<Progress>>,
    offset: u64,
    rate: u64,
) -> ByteStream {
    ByteStream::new(body.into_inner().map_preserve_contents(move |inner| {
        SdkBody::from_body_1_x(TrackedBody {
            inner,
            progress: progress.clone(),
            position: offset,
            started: false,
            rate,
            held: None,
            sleep: None,
            pacing_started: None,
            pacing_bytes: 0,
        })
    }))
}

pub struct SpeedWindow {
    samples: VecDeque<(Instant, u64)>,
    attempt: u64,
}

impl SpeedWindow {
    pub fn new(now: Instant) -> Self {
        Self {
            samples: VecDeque::from([(now, 0)]),
            attempt: 0,
        }
    }

    pub fn sample(&mut self, now: Instant, position: u64, attempt: u64) -> f64 {
        if attempt != self.attempt
            || self
                .samples
                .back()
                .is_some_and(|(_, previous)| position < *previous)
        {
            self.samples.clear();
            self.attempt = attempt;
        }
        self.samples.push_back((now, position));
        while self.samples.len() > 1
            && now.duration_since(self.samples[0].0) > Duration::from_secs(2)
        {
            self.samples.pop_front();
        }
        let (start, bytes) = self.samples[0];
        let elapsed = now.duration_since(start).as_secs_f64();
        if elapsed > 0.0 {
            position.saturating_sub(bytes) as f64 / elapsed
        } else {
            0.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn limited_body_preserves_length_contents_and_retry_pacing() {
        let progress = Arc::new(Mutex::new(Progress::default()));
        let body = track_limited(
            ByteStream::from(vec![7; 65536]),
            progress.clone(),
            10,
            65536,
        )
        .into_inner();
        assert_eq!(Body::size_hint(&body).exact(), Some(65536));
        let retry = body.try_clone().unwrap();
        for body in [body, retry] {
            let start = tokio::time::Instant::now();
            let bytes = ByteStream::new(body).collect().await.unwrap().into_bytes();
            assert_eq!(bytes.as_ref(), vec![7; 65536]);
            assert!(start.elapsed() >= Duration::from_secs(1));
            assert_eq!(progress.lock().unwrap().position, 65546);
        }
        assert_eq!(progress.lock().unwrap().attempt, 1);
    }

    #[tokio::test(start_paused = true)]
    async fn limited_body_can_be_cancelled_during_wait_without_reporting_sent_bytes() {
        let progress = Arc::new(Mutex::new(Progress::default()));
        let body = track_limited(ByteStream::from(vec![0; 65536]), progress.clone(), 0, 65536);
        assert!(
            tokio::time::timeout(Duration::from_millis(100), body.collect())
                .await
                .is_err()
        );
        assert_eq!(progress.lock().unwrap().position, 0);
    }

    #[test]
    fn rolling_rate_stalls_and_retries_reset() {
        let start = Instant::now();
        let mut speed = SpeedWindow::new(start);
        assert_eq!(
            speed.sample(start + Duration::from_secs(1), 1024, 0),
            1024.0
        );
        assert_eq!(speed.sample(start + Duration::from_secs(4), 1024, 0), 0.0);
        assert_eq!(speed.sample(start + Duration::from_secs(5), 0, 1), 0.0);
        assert_eq!(speed.sample(start + Duration::from_secs(6), 512, 1), 512.0);
    }

    #[tokio::test]
    async fn body_preserves_bytes_length_and_retry_offsets() {
        let progress = Arc::new(Mutex::new(Progress::default()));
        let body = track(ByteStream::from_static(b"hello"), progress.clone(), 10).into_inner();
        assert_eq!(Body::size_hint(&body).exact(), Some(5));
        let retry = body.try_clone().expect("retryable body");
        assert_eq!(
            ByteStream::new(body)
                .collect()
                .await
                .unwrap()
                .into_bytes()
                .as_ref(),
            b"hello"
        );
        assert_eq!(progress.lock().unwrap().position, 15);
        ByteStream::new(retry).collect().await.unwrap();
        assert_eq!(progress.lock().unwrap().position, 15);
        assert_eq!(progress.lock().unwrap().attempt, 1);
    }
}
