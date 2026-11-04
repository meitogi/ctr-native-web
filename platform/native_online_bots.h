#ifndef NATIVE_ONLINE_BOTS_H
#define NATIVE_ONLINE_BOTS_H

#include "online_server/sv_core.h"

// The host's bots (docs/ONLINECTR_PORT.md, D11) : each one a virtual client
// of the host's own server core, so the wire and sv_core.c stay upstream's.

// Server peer ids of the bots : below the loopback's, far above any guest's.
#define NATIVE_ONLINE_BOT_PEER_FIRST (SV_CORE_MAX_PEERS - 1 - 7)

// Returns callbacks for SvCore_Init, inside NativeOnlineLoopback_Wrap : the
// bots' peers are served here, every other peer goes to `inner`. Registers
// the bridge's bot hooks (native_online.h).
const SvCoreHost *NativeOnlineBots_Wrap(const SvCoreHost *inner);

// A guest's link closed : 1 when a bot keeps that peer and drives its kart
// (an ONLINE > ARCADE race it had not finished, D11.6) ; the caller then does
// not disconnect it from the core.
int NativeOnlineBots_TakeOver(int peerId);

#endif
