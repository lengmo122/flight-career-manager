# Independent Panel Capture

This is original capture code for Mofei Career (模飞生涯). It does not load, run,
or redistribute iAnnouncer or GlassOut binaries. MinHook 1.3.4 is the only
third-party native component; its BSD license ships with the capture binaries.
WIC and Direct3D 12 are Windows system components.

## Architecture

- `panel-discovery.mjs` discovers only MSFS instrument/EFB web views through
  the simulator's loopback Coherent inspector on port 19999. It never opens
  unrelated browser or desktop windows. Scanning does not inject a DLL.
- `panel-agent.mjs` places a two-pixel marker into the selected instrument
  through Runtime.evaluate. The marker expires after 12 seconds without a
  renewal. No Community package, addon replacement, or iAnnouncer is required.
- `MofeiCaptureHost.exe` validates the simulator process name, owns one capture
  session, and loads our `MofeiCapture.dll` only after the user starts capture.
- The DLL tracks legacy D3D12 render-target transitions and asynchronously
  reads a supported texture after queue submission. The host locates the
  marker, crops the panel and encodes JPEG with WIC.
- `panel-service.mjs` serves a separate, token-protected WebSocket stream and
  mobile viewer on port 4186 (or a free fallback port). The career/save server
  stays bound to 127.0.0.1. LAN routes do not expose career or simulator APIs.
- One selected panel can be shared with up to eight viewers. Stop capture
  before selecting another panel. Viewers support aspect fit and fullscreen;
  remote cockpit input is not implemented in this build.

## Test Build 1.0.125

Adds cancellable capture startup, switching the selected panel while capturing,
actual received FPS and viewer counts, detailed status messages on LAN viewers,
stale callback rejection and automatic stop after 20 seconds without a frame.
Native hook installation failures now encode stage and MinHook error as
`-(stage * 100 + error)`: initialize=1, resource barriers=2, reset=3,
queue submission=4, enhanced barriers=5, enable hooks=6.

Enhanced D3D12 texture barriers are now tracked instead of stopping capture;
the internal readback command list uses matching enhanced barriers for the
resource transition. Native regression tests cover both legacy and enhanced
barrier paths, including an auxiliary direct queue.

Live PMDG test on 2026-09-07: 22 panels discovered, zero frames. The already
loaded 1.0.119-era DLL returned -2 (hook installation failure). DLL and host
hashes were verified identical before testing through the installed path.
No game process was terminated or restarted. Testing the new diagnostic DLL
requires restarting MSFS; the exact failing hook remains undetermined.

The desktop capture page now embeds the same authenticated live image viewer
used by LAN devices. Instrument selection is a dropdown above the actual
window, not a grid of text-only cards. A separate window can be opened on the
local computer without a LAN adapter. Status refresh retains the viewer;
leaving the page releases its viewer connection without stopping LAN capture.
The embedded viewer is tested with actual D3D12 pixels. Real PMDG capture has
not been verified. No static cockpit image is substituted for missing frames.

Verified: native D3D12 capture in the dedicated test process; changing JPEG
frames; native -> Node -> WebSocket -> browser decoding; desktop/mobile pixel
checks; stop/restart/quit; authentication and isolated LAN endpoints; all
existing app regressions; read-only discovery of 15 visible panels in the
currently running MSFS 2024 Fenix cockpit.

Not yet verified: loading the capture DLL in real MSFS 2020/2024, compatibility
with particular GPUs or third-party aircraft, sustained-flight performance,
or access from a physical phone through the user's firewall.

Current restrictions:

- DirectX 11 is not supported. Enhanced barriers and GPU device removal stop
  capture rather than guessing GPU resource states. MSFS submissions from
  other direct queues are passed through and ignored; the first direct queue
  with a suitable texture and successfully initialized readback remains the
  capture queue. This is not full per-queue capture: instruments rendered only
  on a different queue may still produce no frames.
- Single-mip, single-sample RGBA/BGRA8 targets up to 4096x4096 are supported.
  HDR/float, arrays, split/partial resource barriers and hidden or overlapping
  lower instruments are not captured.
- Maximum FPS is a viewer rate limit, not a guaranteed capture rate. Complex
  cockpit rendering can reduce the actual rate.
- If the Coherent inspector is unavailable, discovery reports an error. There
  is no dependency fallback to another application.
- Allow the application through Windows Firewall on a trusted private LAN
  if necessary. No firewall rules are silently installed. Anyone holding a
  current share link can view that panel; do not publish the link.
- Normal stop/quit exits the host, clears markers, stops GPU readback and
  closes LAN connections. The inactive DLL remains in the simulator until
  MSFS exits; unloading active graphics hooks would be unsafe. After updating
  to a capture DLL in another installation path, restart MSFS before capture.
- An app crash causes pipe EOF in the host and heartbeat expiration in the
  DLL. Never force-terminate the simulator as part of cleanup.

## Build And Test

Run `tools\panel-capture-source\build.cmd` with Visual Studio C++ tools and
Windows SDK installed. The current script uses the installed VS 18 path.
Source and build inputs remain in the development folder; installers contain
only the DLL, host EXE and MinHook license.

Run `pnpm test:panels`, `pnpm test:panels:native`, and `pnpm check`.
For browser pixel verification, set `FCM_PLAYWRIGHT_MODULE` to the Playwright
module URL and run `node tests/panel-native-lan.test.mjs`. This test loads code
only into its own `MofeiCaptureTest.exe`, never the user's simulator.
