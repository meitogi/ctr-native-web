#ifndef NATIVE_ONLINE_LOOPBACK_H
#define NATIVE_ONLINE_LOOPBACK_H

#include "online_server/sv_core.h"

// The host's own client reaches the in-process server core by function
// call: NativeOnline_LoopbackTransport on the client side, and this peer
// id on the core side.
#define NATIVE_ONLINE_LOOPBACK_PEER (SV_CORE_MAX_PEERS - 1)

// Returns callbacks for SvCore_Init: the loopback peer is served here,
// every other peer goes to `inner` (the ENet adapter natively, the
// browser transport in session 9).
const SvCoreHost *NativeOnlineLoopback_Wrap(const SvCoreHost *inner);

#endif
