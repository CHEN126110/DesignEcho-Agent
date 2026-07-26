# Dependency risk register

Last reviewed: 2026-07-26.

The initial open-source audit found production dependency advisories in the Electron Agent tree. The project should be treated as experimental until these are resolved or isolated.

## Current priorities

1. Replace or isolate the Volcengine SDK chain that carries unresolved `protobufjs`, `axios` and `uuid` advisories.
2. Upgrade direct `axios` and `ws` versions after provider and WebSocket regression tests.
3. Validate a compatible `sharp` upgrade against image processing and packaging.
4. Review the `onnxruntime-node`/`adm-zip` advisory without downgrading runtime behavior blindly.
5. Keep Dependabot, CodeQL and release-time `npm audit --omit=dev` checks active.

An advisory count is not by itself proof of exploitability in DesignEcho, but unresolved critical or high findings must not be hidden. Release notes should state the dependency audit status and the actual mitigations applied.
