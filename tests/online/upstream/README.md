# Upstream OnlineCTR server, unchanged

Copied byte for byte from CTR-ModSDK
[`e3f19686`](https://github.com/CTR-tools/CTR-ModSDK/tree/e3f19686fb07d62847836ae77c733573a54d3534)
(GPL-3.0), in upstream's directory layout so its relative `#include` of
`global.h` resolves:

- `mods/Windows/OnlineCTR/Network_PC/Server/SV_main.c`
- `mods/Windows/OnlineCTR/Network_PC/Server/SV_helper.c`
- `decompile/General/AltMods/OnlineCTR/global.h`

`tests/online` builds them against `externals/enet` as `ctr_srv_upstream`,
the reference the scripted clients and `sv_core.c` are compared with. Do not
edit them ; a re-sync is a fresh copy from CTR-ModSDK.
