// ENet adapter of sv_core.c: what SV_main.c did with ENet, nothing else.

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

#include <enet/enet.h>

#include "sv_enet.h"

#define SV_ENET_MAX_PEERS 256
#define SV_ENET_MAX_BANS 1024

static ENetHost *server;
static unsigned int bans[SV_ENET_MAX_BANS];
static int numBans;

static void PrintTime(void)
{
	time_t timer = time(NULL);
	char buffer[32];

	strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", localtime(&timer));
	fputs(buffer, stdout);
}

static void SvEnet_Log(const char *fmt, ...)
{
	va_list args;

	printf("[");
	PrintTime();
	printf("] ");
	va_start(args, fmt);
	vprintf(fmt, args);
	va_end(args);
	fflush(stdout);
}

static ENetPeer *Peer(int peerId)
{
	if (!server || peerId < 0 || peerId >= (int)server->peerCount)
		return NULL;
	return &server->peers[peerId];
}

static void SvEnet_Send(int peerId, const void *buf, int len, int reliable)
{
	ENetPeer *peer = Peer(peerId);
	ENetPacket *packet;

	if (!peer || peer->state != ENET_PEER_STATE_CONNECTED)
		return;

	packet = enet_packet_create(buf, len, reliable ? ENET_PACKET_FLAG_RELIABLE : ENET_PACKET_FLAG_UNSEQUENCED);
	if (enet_peer_send(peer, 0, packet) < 0)
		enet_packet_destroy(packet);
}

static void SvEnet_Kick(int peerId)
{
	ENetPeer *peer = Peer(peerId);

	if (peer)
		enet_peer_disconnect_now(peer, 0);
}

static void SvEnet_SetTimeout(int peerId, int ms)
{
	ENetPeer *peer = Peer(peerId);

	if (peer)
		enet_peer_timeout(peer, 1000000, 1000000, ms);
}

static const SvCoreHost svEnetHost = {
	SvEnet_Send,
	SvEnet_Kick,
	SvEnet_SetTimeout,
	SvEnet_Log,
};

const SvCoreHost *SvEnet_CoreHost(void)
{
	return &svEnetHost;
}

void SvEnet_AddBan(unsigned int ip)
{
	if (numBans < SV_ENET_MAX_BANS)
		bans[numBans++] = ip;
}

static int AnyMatchIPBanL(unsigned int ip)
{
	for (int i = 0; i < numBans; i++)
		if (bans[i] == ip)
			return 1;
	return 0;
}

int SvEnet_Start(int port)
{
	ENetAddress address;

	if (enet_initialize() != 0)
	{
		fprintf(stderr, "Failed to initialize ENet!\n");
		return 1;
	}
	atexit(enet_deinitialize);

	address.host = ENET_HOST_ANY;
	address.port = port;
	server = enet_host_create(&address,
		SV_ENET_MAX_PEERS	/* 8 clients in 16 rooms (128) plus more people in lobby */,
		2	/* allow up to 2 channels to be used, 0 and 1 */,
		0	/* assume any amount of incoming bandwidth */,
		0	/* assume any amount of outgoing bandwidth */);

	if (!server)
	{
		fprintf(stderr, "Error: Failed to create an ENet server host!\n");
		return 1;
	}

	SvEnet_Log("Ready on port %d\n", port);
	return 0;
}

void SvEnet_Service(void)
{
	ENetEvent event;

	while (enet_host_service(server, &event, 0) > 0)
	{
		int peerId = (int)(event.peer - server->peers);

		switch (event.type)
		{
			case ENET_EVENT_TYPE_RECEIVE:
				SvCore_Receive(peerId, event.packet->data, (int)event.packet->dataLength);
				enet_packet_destroy(event.packet);
				break;

			case ENET_EVENT_TYPE_CONNECT:
			{
				unsigned int ip = event.peer->address.host;
				if (AnyMatchIPBanL(ip)) //if this IP is banned
				{
					const unsigned char *b = (const unsigned char *)&ip;
					SvEnet_Log("Banned player @ IP [%d.%d.%d.%d] attempted to connect, rejected\n", b[0], b[1], b[2], b[3]);
					enet_peer_disconnect_now(event.peer, 0);
				}
				else
					SvCore_Connect(peerId,
						((unsigned long long)event.peer->address.host << 16) | event.peer->address.port);
				break;
			}

			case ENET_EVENT_TYPE_DISCONNECT:
				SvCore_Disconnect(peerId);
				break;

			default:
				break;
		}
	}
}
