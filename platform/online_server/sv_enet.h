#ifndef SV_ENET_H
#define SV_ENET_H

#include "sv_core.h"

// ENet adapter of the OnlineCTR server core: one ENet peer = one core peer,
// peerId = index in the ENet host's peer array.

int SvEnet_Start(int port);
void SvEnet_AddBan(unsigned int ip);

// drains ENet events into the core (upstream: ProcessNewMessages)
void SvEnet_Service(void);

// callbacks to hand to SvCore_Init (alone, or wrapped by the loopback backend)
const SvCoreHost *SvEnet_CoreHost(void);

#endif
