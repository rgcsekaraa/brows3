# Experimental 32-bit Linux build

The existing `amd64` downloads are for both Intel and AMD **64-bit** systems.
This trial targets a different platform: `i686-unknown-linux-gnu`, packaged with
the Debian architecture name `i386`. It is not a promise of support for original
386/486 CPUs or for every 32-bit distribution.

## Validation before release

Run the manual **Experimental Linux 32-bit** workflow. It uses a Debian 12
build environment, a 64-bit Rust compiler, and 32-bit GTK/WebKitGTK libraries.
The frontend is built separately and embedded in the executable. Cross-building
avoids the address-space limit of a 32-bit compiler processing the AWS SDK.

The workflow checks that the executable is really ELF32/Intel 80386, runs the
backend tests on that target, creates `Brows3_<VERSION>_i386.deb`, derives its
runtime dependencies from the executable, installs the package, and checks that
the installed app starts. It uploads an Actions artifact only, not a public
release. A successful run is required before downloading a candidate for manual
testing. The usual five-platform releases do not depend on this trial.

Before advertising support:

1. Test the candidate in a real 32-bit Linux installation with WebKitGTK 4.1.
2. Check login, keyring persistence, upload/download/cancellation, large files,
   previews, and memory use on limited-RAM hardware.
3. Confirm Jeff's distribution, `uname -m`, and `getconf LONG_BIT` output.
4. Use a new release version and matching source tag for public distribution.
   If publishing an experimental prerelease, label it as such; the website lists
   only stable-release assets and will not advertise it prematurely.

Native in-app updater endpoints are disabled for this build, so updates must be
installed manually. There is no 32-bit AppImage or Cargo prebuilt release yet.
AppImage bundling and update support need separate validation before adding them.

Use the user-facing name **Intel / AMD 32-bit (x86)**. Keep the standard `i386`
package filename and Debian metadata so package managers recognize it. Keep
existing `amd64` filenames unchanged to avoid breaking download and updater URLs.

References: [Debian 12 WebKitGTK 4.1 development packages](https://packages.debian.org/bookworm/libwebkit2gtk-4.1-dev)
and [AWS-LC target support](https://aws.github.io/aws-lc-rs/platform_support.html).
