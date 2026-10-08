import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { encryptToken } from '@/lib/wings/crypto';
import { logActivity } from '@/lib/wings/resolve';
import type { SeedSummary } from '@/types';

export const runtime = 'nodejs';

/**
 * POST /api/admin/seed
 *
 * Seed node existing + 5 server existing (hasil rekonstruksi docker inspect)
 * ke database. Idempotent: data yang sudah ada (berdasar UUID) di-skip.
 *
 * Hanya Owner Panel/Admin. Token node mentah dibaca dari env WINGS_SEED_NODE_TOKEN,
 * dienkripsi AES-256-GCM sebelum disimpan, dan TIDAK PERNAH ditulis ke log.
 */

const SEED_NODE = {
  uuid: '8fb7b6ba-ebaa-4c46-932c-4b376b7f0c97',
  name: 'Node 2 — ID',
  fqdn: 'node2.wangstore.web.id',
  port: 8080,
  token_id: '2ZSqe7LfqTEqHAWN',
  location: 'ID',
} as const;

interface SeedServer {
  uuid: string;
  name: string;
  image: string;
  status: 'running' | 'exited';
  port: number;
  memory_mb: number;
  cpu_limit: number;
  startup: string;
  env: Record<string, string>;
}

const SEED_SERVERS: SeedServer[] = [
  {
    uuid: '45cf343c-f0f6-441a-a0fe-616a975c764a',
    name: 'NodeJS App',
    image: 'ghcr.io/ptero-eggs/yolks:nodejs_25',
    status: 'running',
    port: 25575,
    memory_mb: 1150,
    cpu_limit: 100,
    startup:
      'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; if [[ "${MAIN_FILE}" == "*.js" ]]; then /usr/local/bin/node "/home/container/${MAIN_FILE}" ${NODE_ARGS}; else /usr/local/bin/ts-node --esm "/home/container/${MAIN_FILE}" ${NODE_ARGS}; fi',
    env: {
      MAIN_FILE: 'server.js',
      NODE_ARGS: '',
      AUTO_UPDATE: '0',
      NODE_PACKAGES: '',
      UNNODE_PACKAGES: '',
      GIT_ADDRESS: '',
      USERNAME: '',
      ACCESS_TOKEN: '',
      BRANCH: '',
      USER_UPLOAD: '0',
    },
  },
  {
    uuid: '9382192a-2b1e-4b1f-b837-98341d7a693f',
    name: 'Bedrock 1',
    image: 'ghcr.io/ptero-eggs/yolks:debian',
    status: 'exited',
    port: 25566,
    memory_mb: 3300,
    cpu_limit: 300,
    startup: './bedrock_server',
    env: {
      BEDROCK_VERSION: '1.26.33.1',
      SERVERNAME: 'GamePE',
      DIFFICULTY: 'normal',
      GAMEMODE: 'survival',
      CHEATS: 'true',
      LD_LIBRARY_PATH: '.',
    },
  },
  {
    uuid: 'cdbb3315-0675-4f57-baf6-3f3e12af0e68',
    name: 'Java MC 1',
    image: 'ghcr.io/pterodactyl/yolks:java_25',
    status: 'running',
    port: 25565,
    memory_mb: 10000,
    cpu_limit: 300,
    startup: 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}',
    env: {
      SERVER_JARFILE: 'server.jar',
      MINECRAFT_VERSION: '26.2',
      BUILD_NUMBER: 'latest',
      DL_PATH: '',
    },
  },
  {
    uuid: '96721452-3826-4c80-87a1-bfdb5c7e6b3c',
    name: 'Java MC 2',
    image: 'ghcr.io/pterodactyl/yolks:java_25',
    status: 'running',
    port: 25571,
    memory_mb: 10000,
    cpu_limit: 400,
    startup:
      'java -Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true -jar {{SERVER_JARFILE}}',
    env: {
      SERVER_JARFILE: 'server.jar',
      MINECRAFT_VERSION: 'latest',
      BUILD_NUMBER: 'latest',
      DL_PATH: '',
    },
  },
  {
    uuid: '52e703f5-8cd5-4dc7-8824-27ee1b882115',
    name: 'Bedrock 2',
    image: 'ghcr.io/ptero-eggs/yolks:debian',
    status: 'exited',
    port: 25574,
    memory_mb: 3300,
    cpu_limit: 300,
    startup: './bedrock_server',
    env: {
      BEDROCK_VERSION: '26.52',
      SERVERNAME: 'Bedrock Dedicated Server',
      DIFFICULTY: 'easy',
      GAMEMODE: 'creative',
      CHEATS: 'true',
      LD_LIBRARY_PATH: '.',
    },
  },
];

export async function POST() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const service = getSupabaseServiceClient();
  const summary: SeedSummary = {
    node: 'skipped',
    servers_inserted: 0,
    servers_skipped: 0,
    allocations_inserted: 0,
    details: [],
  };

  // ── 1. Node ──────────────────────────────────────────────────────────────
  let nodeId: string | null = null;
  const { data: existingNode } = await service
    .from('nodes')
    .select('id')
    .eq('uuid', SEED_NODE.uuid)
    .maybeSingle();

  if (existingNode) {
    nodeId = existingNode.id as string;
    summary.node = 'skipped';
  } else {
    const plainToken = process.env.WINGS_SEED_NODE_TOKEN ?? '';
    if (!plainToken) {
      summary.node = 'token-missing';
      return Response.json(
        {
          ...summary,
          error:
            'WINGS_SEED_NODE_TOKEN belum di-set. Isi env dengan token Wings node (field "token" di /etc/pterodactyl/config.yml), lalu panggil ulang endpoint ini.',
        },
        { status: 400 },
      );
    }
    const { data: insertedNode, error: nodeErr } = await service
      .from('nodes')
      .insert({
        uuid: SEED_NODE.uuid,
        name: SEED_NODE.name,
        fqdn: SEED_NODE.fqdn,
        port: SEED_NODE.port,
        token_id: SEED_NODE.token_id,
        token_encrypted: encryptToken(plainToken),
        location: SEED_NODE.location,
      })
      .select('id')
      .single();
    if (nodeErr || !insertedNode) {
      return Response.json({ error: `Gagal insert node: ${nodeErr?.message}` }, { status: 500 });
    }
    nodeId = insertedNode.id as string;
    summary.node = 'inserted';
  }

  // ── 2. Servers + Allocations ─────────────────────────────────────────────
  for (const seed of SEED_SERVERS) {
    const { data: existingServer } = await service
      .from('servers')
      .select('id')
      .eq('uuid', seed.uuid)
      .maybeSingle();

    if (existingServer) {
      summary.servers_skipped += 1;
      summary.details.push({ uuid: seed.uuid, name: seed.name, action: 'skipped' });
      continue;
    }

    // Allocation (idempotent via unique node+ip+port)
    let allocationId: string | null = null;
    const { data: existingAlloc } = await service
      .from('allocations')
      .select('id')
      .eq('node_id', nodeId)
      .eq('ip', '0.0.0.0')
      .eq('port', seed.port)
      .maybeSingle();

    if (existingAlloc) {
      allocationId = existingAlloc.id as string;
    } else {
      const { data: newAlloc } = await service
        .from('allocations')
        .insert({ node_id: nodeId, ip: '0.0.0.0', port: seed.port })
        .select('id')
        .single();
      allocationId = (newAlloc?.id as string) ?? null;
      if (allocationId) summary.allocations_inserted += 1;
    }

    const { data: insertedServer, error: serverErr } = await service
      .from('servers')
      .insert({
        uuid: seed.uuid,
        name: seed.name,
        node_id: nodeId,
        owner_id: admin.id,
        allocation_id: allocationId,
        memory_mb: seed.memory_mb,
        cpu_limit: seed.cpu_limit,
        disk_mb: null,
        image: seed.image,
        startup: seed.startup,
        env: seed.env,
        status: seed.status === 'running' ? 'running' : 'offline',
        is_suspended: false,
      })
      .select('id')
      .single();

    if (serverErr || !insertedServer) {
      return Response.json(
        { ...summary, error: `Gagal insert server ${seed.name}: ${serverErr?.message}` },
        { status: 500 },
      );
    }

    if (allocationId) {
      await service
        .from('allocations')
        .update({ assigned_to: insertedServer.id })
        .eq('id', allocationId);
    }

    summary.servers_inserted += 1;
    summary.details.push({ uuid: seed.uuid, name: seed.name, action: 'inserted' });
  }

  await logActivity({
    userId: admin.id,
    action: 'admin:seed',
    metadata: {
      node: summary.node,
      servers_inserted: summary.servers_inserted,
      servers_skipped: summary.servers_skipped,
    },
  });

  return Response.json(summary);
}
