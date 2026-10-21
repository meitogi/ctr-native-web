#ifndef SV_CORE_H
#define SV_CORE_H

// OnlineCTR server logic without a network: rooms, CG_* handlers, tick,
// disconnect rules. Adapters (ENet natively, the browser host in session 9)
// feed it events and carry its output. docs/ONLINECTR_PORT.md, D4.

// 256 ENet peers (upstream's host size) plus the host's own loopback client
#define SV_CORE_MAX_PEERS 260

typedef struct SvCoreHost
{
	void (*send)(int peerId, const void *buf, int len, int reliable);

	// drop the connection (upstream: enet_peer_disconnect_now)
	void (*kick)(int peerId);

	// idle timeout of that peer (upstream: enet_peer_timeout, 2 s in the
	// room list, 5 s once in a room) ; may be NULL
	void (*setTimeout)(int peerId, int ms);

	// may be NULL
	void (*log)(const char *fmt, ...);
} SvCoreHost;

void SvCore_Init(const SvCoreHost *host);

// addressKey replaces upstream's same IP and port duplicate check
void SvCore_Connect(int peerId, unsigned long long addressKey);
void SvCore_Receive(int peerId, const void *buf, int len);
void SvCore_Disconnect(int peerId);

// wall-clock milliseconds ; upstream measured the 6 s room reset in CPU time
void SvCore_Tick(unsigned int nowMs);

#endif
