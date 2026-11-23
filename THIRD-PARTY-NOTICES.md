# Third-party notices

Powernux is distributed under the MIT License (see `LICENSE`). It includes or depends on
the following third-party software. Their licenses apply to their respective parts.

## Icons

**Font Awesome Free** — by Fonticons, Inc. — https://fontawesome.com
- Icons: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Code (React component and SVG core): [MIT](https://opensource.org/licenses/MIT)
- Brand icons (GitHub, LinkedIn) are trademarks of their respective owners and are used only to link to the author's profiles.

Icons used in Powernux are taken unchanged from `@fortawesome/free-solid-svg-icons`,
`@fortawesome/free-regular-svg-icons` and `@fortawesome/free-brands-svg-icons`.

## Application framework and libraries

| Software | License | Website |
|---|---|---|
| Tauri (core and plugins `opener`, `single-instance`) | MIT or Apache-2.0 | https://tauri.app |
| React, React DOM | MIT | https://react.dev |
| Vite | MIT | https://vite.dev |
| reqwest, rustls | MIT or Apache-2.0 (rustls: also ISC) | https://github.com/seanmonstar/reqwest |
| serde, serde_json | MIT or Apache-2.0 | https://serde.rs |
| sha2, ed25519-dalek, base64 | MIT or Apache-2.0 (ed25519-dalek: BSD-3-Clause) | https://github.com/RustCrypto |
| tar, flate2, semver | MIT or Apache-2.0 | https://crates.io |
| keyring | MIT or Apache-2.0 | https://github.com/hwchen/keyring-rs |
| arboard | MIT or Apache-2.0 | https://github.com/1Password/arboard |
| x11rb | MIT or Apache-2.0 | https://github.com/psychon/x11rb |

The complete list of Rust and JavaScript dependencies, with their licenses, is in
`src-tauri/Cargo.lock`, `tools/*/Cargo.lock` and `package-lock.json`.

## System components used at runtime (not distributed with Powernux)

GNOME Shell, Mutter, GStreamer, WebKitGTK, GLib/GIO and the GNOME Keyring are used from the
user's system through their public interfaces.
