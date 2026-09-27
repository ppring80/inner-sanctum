# Vendored third-party code

Files here are copied byte-for-byte from their published packages and are
served as static assets. They are not bundled or modified.

| File | Package | Version | License | Source | SHA-256 |
|---|---|---|---|---|---|
| `qrcode-generator-2.0.4.js` | [`qrcode-generator`](https://www.npmjs.com/package/qrcode-generator) (`dist/qrcode.js`) | 2.0.4 | MIT, © 2009 Kazuhiko Arase (header retained) | https://github.com/kazuhikoarase/qrcode-generator | `79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c` |

`qrcode-generator` is used only by `mobile-connect.js` to draw the
"Send to my phone" QR code. It is loaded lazily on that click, has no
dependencies, and performs no network, DOM or `eval` access; it only computes
the QR module matrix locally, so the one-time link never leaves the browser to
draw the code.

`tests/vendor-integrity.test.js` pins the hash. To upgrade: replace the file
with the new published `dist/qrcode.js`, update the filename, version, the
hash here and in the test, and `QR_SCRIPT_SRC` in `mobile-connect.js`.
