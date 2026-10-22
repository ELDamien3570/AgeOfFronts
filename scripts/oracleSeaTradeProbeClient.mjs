import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import WebSocket from "ws";
import { serialize } from "node:v8";
import { decodeState } from "../src/skirmish/multiplayer/StateCodec.ts";
import { SnapshotDecoder } from "../src/skirmish/SnapshotCodec.ts";
const args = process.argv.slice(2),
  get = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const base = get("--url", "http://127.0.0.1:18081"),
  seconds = Number(get("--seconds", "900")),
  out = get("--out", "out/sea-trade/oracle-client");
if (!Number.isInteger(seconds) || seconds < 20 || seconds > 3600)
  throw Error("seconds 20..3600");
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))
  throw Error("Use a localhost or SSH-forwarded probe");
mkdirSync(out, { recursive: false });
const probeUrl =
  get(
    "--probe-url",
    base.replace(/:\d+$/, (m) => ":" + (Number(m.slice(1)) + 1)),
  ) + "/probe";
const metadata = await (await fetch(probeUrl)).json();
writeFileSync(out + "/metadata.json", JSON.stringify(metadata, null, 2));
const peers = [],
  orders = [],
  failures = [],
  hashes = new Map();
let sequence = 0,
  matchId,
  closing = false,
  comparedFrames = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  rid = () => "sea-probe-" + ++sequence,
  send = (p, m) => {
    const id = rid();
    if (m.type === "match-command") appendFileSync(out + "/commands-sent.jsonl", JSON.stringify({ id, peer: p.index, at: Date.now(), observedTick: p.tick, command: m.command }) + "\n");
    p.ws.send(JSON.stringify({ requestId: id, ...m }));
    return id;
  };
const until = async (fn, label, limit = 180000) => {
  const start = Date.now();
  while (!fn()) {
    if (failures.length) throw Error(failures[0]);
    if (Date.now() - start > limit) throw Error("Timed out: " + label);
    await sleep(25);
  }
};
const recordOutcome = (p, m) => {
  const row = orders.find((r) => r.id === m.outcome.id);
  if (!row) return;
  row.outcomes.push({ at: Date.now(), ...m.outcome });
  if (m.outcome.status === "executed")
    row.executedMs ??= Date.now() - row.sentAt;
  if (m.outcome.status === "rejected" || m.outcome.status === "superseded")
    row.terminal = m.outcome.status;
};
async function connect(index) {
  const response = await fetch(base + "/guest", {
      method: "POST",
      headers: { Origin: base },
    }),
    { token } = await response.json();
  const p = {
    index,
    token,
    decoder: new SnapshotDecoder(),
    chain: Promise.resolve(),
    acks: new Map(),
    packets: 0,
    gaps: [],
    decodeMs: [],
  };
  peers.push(p);
  p.ws = new WebSocket(base.replace("http", "ws") + "/socket", {
    origin: base,
  });
  p.ws.on("error", (e) => failures.push(e.message));
  p.ws.on("close", () => {
    if (!closing) failures.push("Unexpected peer close " + index);
  });
  p.ws.on("message", (raw) => {
    p.chain = p.chain
      .then(async () => {
        const m = JSON.parse(raw.toString());
        if (m.type === "error") failures.push(m.message);
        if (m.type === "directory") p.directory = m;
        if (m.type === "ack") {
          p.acks.set(m.requestId, m);
          const row = orders.find((r) => r.id === m.requestId);
          if (row) row.ackMs = Date.now() - row.sentAt;
        }
        if (m.type === "match") {
          p.manifest = m.manifest;
          matchId = m.manifest.id;
          send(p, {
            type: "match-ready",
            matchId,
            runtimeId: m.manifest.runtimeId,
            flowControl: true,
          });
        }
        if (m.type === "match-command-outcome") recordOutcome(p, m);
        if (m.type === "match-ended" && !closing)
          failures.push("Unexpected match end: " + m.message);
        if (m.type !== "match-state") return;
        const at = performance.now(),
          packet = await decodeState(m.packet);
        if (m.rebase) p.decoder = new SnapshotDecoder();
        let snap;
        try { snap = p.decoder.decode(packet, false, false); }
        catch (error) {
          if (!p.failedPacketCaptured) {
            p.failedPacketCaptured = true;
            writeFileSync(out + `/failed-packet-peer-${index}.v8`, serialize(packet));
            writeFileSync(out + `/failed-packet-peer-${index}.json`, JSON.stringify({ tick: m.tick, previousTick: p.tick, rebase: m.rebase, publicationSequence: m.publicationSequence, error: error.stack ?? error.message }, null, 2));
          }
          throw error;
        }
        p.decodeMs.push(performance.now() - at);
        p.stationary ??= new Map();
        for (const s of snap.squads) {
          const old = p.stationary.get(s.id);
          p.stationary.set(s.id, {
            x: s.x,
            y: s.y,
            count: old && old.x === s.x && old.y === s.y ? old.count + 1 : 0,
          });
        }
        p.snapshot = snap;
        p.tick = m.tick;
        p.packets++;
        if (p.lastAt) p.gaps.push(Date.now() - p.lastAt);
        p.lastAt = Date.now();
        // State hash comparison uses the same publication; bounded to 32 frames.
        const key = m.publicationSequence ?? m.tick,
          hash = createHash("sha256")
            .update(snap.owners)
            .update(
              JSON.stringify([
                snap.squads,
                snap.ships,
                snap.buildings,
                snap.expansion?.traders,
                snap.expansion?.armies,
                snap.players,
              ]),
            )
            .digest("hex");
        const row = hashes.get(key) ?? new Map();
        row.set(index, hash);
        hashes.set(key, row);
        if (row.size === 2) comparedFrames++;
        if (new Set(row.values()).size > 1)
          failures.push("Client state disagreement at " + key);
        while (hashes.size > 32) hashes.delete(hashes.keys().next().value);
        for(const order of orders)if(order.peer===index && order.settled && !order.terminal){
          order.memberResponses ??= order.starts.map(start=>({id:start.id}));
          for(const start of order.starts){
            const squad=snap.squads.find(s=>s.id===start.id),response=order.memberResponses.find(r=>r.id===start.id);
            if(!squad)continue;
            const elapsed=Date.now()-order.sentAt;
            if(response.firstTurnMs===undefined && start.heading!==undefined && squad.locomotion?.heading!==undefined && Math.abs(Math.atan2(Math.sin(squad.locomotion.heading-start.heading),Math.cos(squad.locomotion.heading-start.heading)))>1e-6)
              response.firstTurnMs=elapsed;
            if(response.firstMotionMs===undefined && Math.hypot(squad.x-start.x,squad.y-start.y)>8){response.firstMotionMs=elapsed;response.motionTick=m.tick;}
          }
          if(order.executedMs!==undefined)for(const response of order.memberResponses){
            const squad=snap.squads.find(s=>s.id===response.id);
            if(response.firstMotionMs===undefined && squad?.order.type==="hold")response.completedWithoutObservedMotionMs??=Date.now()-order.sentAt;
          }
          const moved=order.memberResponses.filter(r=>r.firstMotionMs!==undefined);
          if(moved.length && order.firstMotionMs===undefined){order.firstMotionMs=Math.min(...moved.map(r=>r.firstMotionMs));order.motionTick=m.tick;order.membersMovedAtFirstObservation=moved.length;}
          if(moved.length===order.starts.length)order.allMotionMs??=Math.max(...moved.map(r=>r.firstMotionMs));
          const settled=order.memberResponses.filter(r=>r.firstMotionMs!==undefined || r.completedWithoutObservedMotionMs!==undefined);
          if(settled.length===order.starts.length)order.allSettledMs??=Math.max(...settled.map(r=>r.firstMotionMs??r.completedWithoutObservedMotionMs));
        }
        if (m.syncId)
          send(p, {
            type: "match-sync-applied",
            matchId: m.matchId,
            syncId: m.syncId,
            publicationSequence: m.publicationSequence,
          });
        else
          send(p, {
            type: "match-state-applied",
            matchId: m.matchId,
            publicationSequence: m.publicationSequence,
            flowEpoch: m.flowEpoch,
          });
      })
      .catch((e) => failures.push(e.stack ?? e.message));
  });
  await new Promise((r, j) => {
    p.ws.once("open", r);
    p.ws.once("error", j);
  });
  p.ws.send(JSON.stringify({ type: "authenticate", token }));
  await until(() => p.directory, "authentication");
  return p;
}
const stats = (xs) => {
  const a = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    count: a.length,
    p50: a[Math.max(0, Math.ceil(a.length * 0.5) - 1)],
    p95: a[Math.max(0, Math.ceil(a.length * 0.95) - 1)],
    p99: a[Math.max(0, Math.ceil(a.length * 0.99) - 1)],
    max: a.at(-1),
  };
};
let started,
  ended,
  startSample,
  endSample,
  attempt = 0,
  skipped = 0;
try {
  const a = await connect(0),
    b = await connect(1);
  const settings = {
    ...metadata.fixture.settings,
    slots: 2,
    minimumHumans: 2,
    countdownSeconds: 15,
    publicAiTakeover: Boolean(metadata.fixture.movementProbePlayer),
  };
  const create = send(a, {
    type: "create",
    title: "Isolated sea-trade Oracle qualification",
    settings,
  });
  await until(() => a.acks.get(create)?.roomId, "room");
  send(b, { type: "join", roomId: a.acks.get(create).roomId });
  await until(
    () => peers.every((p) => p.snapshot && p.tick >= metadata.fixture.tick),
    "late-game baseline",
  );
  if(metadata.fixture.movementProbePlayer){
    const c=await connect(2);
    send(c,{type:"watch-match",matchId,playerId:metadata.fixture.movementProbePlayer});
    await until(()=>c.snapshot && c.manifest?.playerId===metadata.fixture.movementProbePlayer,"existing large faction takeover");
  }
  writeFileSync(
    out + "/manifests.json",
    JSON.stringify(
      peers.map((p) => p.manifest),
      null,
      2,
    ),
  );
  // Hold only selected existing squads, then wait for three unchanged publications.
  // No units/resources/terrain/technology are manufactured by this probe.
  const initial = (await (await fetch(probeUrl)).json()).initial;
  if (!initial?.targets?.length)
    throw Error("Missing validated fixture targets");
  const selected = new Set(
    initial.targets.filter((t) => t.tiles.length).map((t) => t.id),
  );
  for (const p of peers) {
    const owned = p.snapshot.squads.filter(
      (s) => selected.has(s.id) && s.playerId === p.manifest.playerId,
    );
    for(let start=0;start<owned.length;start+=60)send(p,{type:"match-command",matchId,command:{type:"order",playerId:p.manifest.playerId,squadIds:owned.slice(start,start+60).map(s=>s.id),order:{type:"hold"}}});
  }
  await sleep(5000);
  startSample = await (await fetch(probeUrl)).json();
  started = Date.now();
  writeFileSync(
    out + "/measurement-start.json",
    JSON.stringify({
      at: started,
      tick: peers[0].tick,
      seconds,
      server: startSample,
    }),
  );
  let next = started;
  while (Date.now() - started < seconds * 1000) {
    if (failures.length) throw Error(failures[0]);
    if (Date.now() >= next) {
      next += 5000;
      const beforeCount = orders.length;
      const peer = peers[attempt % peers.length],
        kind = Math.floor(attempt / peers.length) % 2 ? "long" : "short";
      attempt++;
      const busy = new Set(
        orders
          .filter((r) => !r.held && !r.terminal)
          .flatMap((r) => r.squadIds),
      );
      const goalsFor = (s) =>
        initial.targets
          .find((t) => t.id === s.id)
          .tiles.filter(
            (tile) =>
              peer.snapshot.owners[tile] === peer.manifest.playerId &&
              (() => {
                const d =
                  Math.hypot(
                    ((tile % peer.snapshot.width) + 0.5) * 256 - s.x,
                    (Math.floor(tile / peer.snapshot.width) + 0.5) * 256 - s.y,
                  ) / 256;
                return kind === "short" ? d >= 2 && d <= 6 : d >= 25 && d <= 50;
              })(),
          );
      const eligible = peer.snapshot.squads.filter(
        (s) =>
          selected.has(s.id) &&
          s.playerId === peer.manifest.playerId &&
          !busy.has(s.id) &&
          s.embarkedOn === null &&
          !s.refit &&
          !s.fighting &&
          s.order.type === "hold" &&
          (peer.stationary.get(s.id)?.count ?? 0) >= 3,
      );
      const s = eligible.find((s) => goalsFor(s).length),
        selectionSize = metadata.fixture.movementProbePlayer
          ? peer.manifest.playerId===metadata.fixture.movementProbePlayer ? [8,60][Math.floor((attempt-1)/peers.length)%2] : [1,8][Math.floor((attempt-1)/peers.length)%2]
          : [1, 4, 8][Math.floor((attempt - 1) / 4) % 3];
      if (s && eligible.length >= selectionSize) {
        const goals = goalsFor(s),
          group = eligible
            .sort(
              (a, b) =>
                selectionSize===60 ? a.id-b.id : Math.hypot(a.x - s.x, a.y - s.y) -
                  Math.hypot(b.x - s.x, b.y - s.y) || a.id - b.id,
            )
            .slice(0, selectionSize);
        if (goals.length) {
          const order = {
            peer: peer.index,
            id: rid(),
            kind,
            selectionSize,
            squadId: s.id,
            squadIds: group.map((s) => s.id),
            starts: group.map((s) => ({ id: s.id, x: s.x, y: s.y, heading:s.locomotion?.heading })),
            playerId: s.playerId,
            tile: goals[Math.floor(attempt / 4) % goals.length],
            start: { x: s.x, y: s.y },
            sentAt: Date.now(),
            sentTick: peer.tick,
            outcomes: [],
            settled: true,
          };
          order.distanceTiles =
            Math.hypot(
              ((order.tile % peer.snapshot.width) + 0.5) * 256 - s.x,
              (Math.floor(order.tile / peer.snapshot.width) + 0.5) * 256 - s.y,
            ) / 256;
          orders.push(order);
          order.memberDistanceTiles = group.map(member => ({ id: member.id, distance: Math.hypot(((order.tile % peer.snapshot.width) + 0.5) * 256 - member.x, (Math.floor(order.tile / peer.snapshot.width) + 0.5) * 256 - member.y) / 256 }));
          appendFileSync(out + "/commands-sent.jsonl", JSON.stringify({ id: order.id, peer: peer.index, at: order.sentAt, observedTick: peer.tick, command: { type: "order", playerId: s.playerId, squadIds: order.squadIds, order: { type: "move", tile: order.tile } } }) + "\n");
          peer.ws.send(
            JSON.stringify({
              type: "match-command",
              requestId: order.id,
              matchId,
              command: {
                type: "order",
                playerId: s.playerId,
                squadIds: order.squadIds,
                order: { type: "move", tile: order.tile },
              },
            }),
          );
        }
      }
      if (orders.length === beforeCount) skipped++;
      // Completed samples return to hold before they are reused; don't supersede pending work.
      for (const row of orders)
        if (!row.held && (row.terminal || row.executedMs !== undefined && row.allSettledMs !== undefined)) {
          row.held = true;
          send(peers[row.peer], {
            type: "match-command",
            matchId,
            command: {
              type: "order",
              playerId: row.playerId,
              squadIds: row.squadIds,
              order: { type: "hold" },
            },
          });
        }
      writeFileSync(out + "/orders.json", JSON.stringify(orders, null, 2));
      console.log(
        JSON.stringify({
          elapsed: Math.round((Date.now() - started) / 1000),
          tick: peers[0].tick,
          orders: orders.length,
          firstMotion: orders.filter((r) => r.firstMotionMs !== undefined)
            .length,
        }),
      );
    }
    await sleep(50);
  }
  ended = Date.now();
  endSample = await (await fetch(probeUrl)).json();
} catch (e) {
  failures.push(e.stack ?? e.message);
  ended = Date.now();
} finally {
  closing = true;
  if (!comparedFrames)
    failures.push("No matching client publications compared");
  for (const p of peers) p.ws?.close();
  await Promise.all(peers.map((p) => p.chain));
  const result = {
    source: metadata.source,
    startSample,
    endSample,
    sampling: { attempted: attempt, skipped },
    comparedFrames,
    initialTick: metadata.fixture.tick,
    started,
    ended,
    wallSeconds: started ? (ended - started) / 1000 : 0,
    failures,
    orders,
    byKind: Object.fromEntries(
      ["short", "long"].map((kind) => {
        const rows = orders.filter((r) => r.kind === kind);
        return [
          kind,
          {
            sent: rows.length,
            ackMs: stats(rows.map((r) => r.ackMs)),
            executedMs: stats(rows.map((r) => r.executedMs)),
            firstMotionMs: stats(rows.map((r) => r.firstMotionMs)),
            allMotionMs: stats(rows.map((r) => r.allMotionMs)),
            completedWithoutObservedMotion: rows.flatMap(r=>r.memberResponses??[]).filter(m=>m.completedWithoutObservedMotionMs!==undefined).length,
            unresolvedMembers: rows.flatMap(r=>r.memberResponses??[]).filter(m=>m.firstMotionMs===undefined && m.completedWithoutObservedMotionMs===undefined).length,
            memberMotionMs: stats(rows.flatMap(r=>(r.memberResponses??[]).map(m=>m.firstMotionMs))),
            memberTurnMs: stats(rows.flatMap(r=>(r.memberResponses??[]).map(m=>m.firstTurnMs))),
            unresolved: rows.filter(
              (r) => r.firstMotionMs === undefined && !r.terminal,
            ).length,
            rejected: rows.filter((r) => r.terminal).length,
            pendingFullCommands: rows.filter(r=>r.executedMs===undefined && !r.terminal).length,
          },
        ];
      }),
    ),
    bySelectionSize: Object.fromEntries(
      [1, 4, 8, 60].map((n) => {
        const rows = orders.filter((r) => r.selectionSize === n);
        return [
          n,
          {
            sent: rows.length,
            executedMs: stats(rows.map((r) => r.executedMs)),
            firstMotionMs: stats(rows.map((r) => r.firstMotionMs)),
            allMotionMs: stats(rows.map((r) => r.allMotionMs)),
            completedWithoutObservedMotion: rows.flatMap(r=>r.memberResponses??[]).filter(m=>m.completedWithoutObservedMotionMs!==undefined).length,
            unresolvedMembers: rows.flatMap(r=>r.memberResponses??[]).filter(m=>m.firstMotionMs===undefined && m.completedWithoutObservedMotionMs===undefined).length,
            memberMotionMs: stats(rows.flatMap(r=>(r.memberResponses??[]).map(m=>m.firstMotionMs))),
            memberTurnMs: stats(rows.flatMap(r=>(r.memberResponses??[]).map(m=>m.firstTurnMs))),
            unresolved: rows.filter(
              (r) => r.firstMotionMs === undefined && !r.terminal,
            ).length,
            rejected: rows.filter((r) => r.terminal).length,
            pendingFullCommands: rows.filter(r=>r.executedMs===undefined && !r.terminal).length,
          },
        ];
      }),
    ),
    peers: peers.map((p) => ({
      index: p.index,
      packets: p.packets,
      lastTick: p.tick,
      decodeMs: stats(p.decodeMs),
      publicationGapMs: stats(p.gaps),
    })),
    limitations:
      "Two or three real WebSocket clients (Oracle runs through an SSH tunnel); production decoder, coordinator, LiveMatch, reserved worker/encoder. Checkpoint initialization is test-only. First motion is each member's first decoded displacement over eight fixed units after the input; it is independent of the aggregate receipt. First turn and all-member motion are reported separately. Holds wait for full command execution and every member's motion, or a terminal failure; not rendered pixels. Short/long classify the lead squad distance; memberDistanceTiles records the full selection spread. Initial short/long destinations are owned, standable and in the same land component; unresolved/rejections remain in result.",
  };
  writeFileSync(out + "/result.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.byKind));
  if (failures.length) {
    console.error(failures);
    process.exitCode = 1;
  }
}
