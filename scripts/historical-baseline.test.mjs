import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORY_GAME,
  V2_EVENTS,
  canonicalLogs,
  historyHash,
  recordEpisodes,
  reconstructBaseline,
  validateReceipts,
  validateWallets,
} from "./historical-baseline.mjs";
import { HISTORY_RPCS, readRpcBatch } from "./historical-rpc.mjs";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const hash = (number) => `0x${BigInt(number).toString(16).padStart(64, "0")}`;
const hex = (number) => `0x${BigInt(number).toString(16)}`;
function history() {
  const logs = [],
    headers = {};
  const times = [100, 105, 111, 112],
    end = 120;
  const gestures = times.map((timestamp) => ({ timestamp, address: A }));
  const records = recordEpisodes(gestures, end);
  function emit(name, args, block, index, timestamp) {
    const encoded = V2_EVENTS.encodeEventLog(V2_EVENTS.getEvent(name), args);
    const log = {
      address: HISTORY_GAME,
      topics: encoded.topics,
      data: encoded.data,
      blockNumber: hex(block),
      transactionIndex: "0x0",
      logIndex: hex(index),
      blockHash: hash(block),
      transactionHash: hash(block + 1000),
      removed: false,
    };
    logs.push(log);
    headers[hex(block)] = {
      number: hex(block),
      hash: hash(block),
      timestamp: hex(timestamp),
      parentHash: hash(block - 1),
      receiptsRoot: hash(4000 + block),
      stateRoot: hash(5000 + block),
    };
  }
  emit("FirstBidPlacedInRound", [2, times[0]], 1, 0, times[0]);
  for (let index = 0; index < times.length; index++) {
    const cst = index % 2 === 1;
    emit(
      "BidPlaced",
      [2, A, cst ? -1 : 10, cst ? index : -1, -1, "", 0, 10, 119],
      index + 1,
      index === 0 ? 1 : 0,
      times[index],
    );
  }
  emit("EnduranceChampionPrizePaid", [2, records.endurance.address, 0, 1], 5, 0, end);
  emit("ChronoWarriorPrizePaid", [2, 0, records.chrono.address, 0, 0, 2], 5, 1, end);
  emit("MainPrizeClaimed", [2, A, 0, 0, 3, 1000], 5, 2, end);
  return { logs, headers };
}
function replay(data = history()) {
  return reconstructBaseline(data.logs, data.headers, { expectedCount: 4 });
}
function wallets(result) {
  return [...result.wallets].map(([address, values]) => ({
    address,
    ethSpent: values.ethSpent.toString(),
    cstBurned: values.cstBurned.toString(),
    lastGestureAt: values.lastGestureAt.toString(),
  }));
}
function receipts(data) {
  const byHash = new Map();
  for (const log of data.logs) {
    const receipt = byHash.get(log.transactionHash) ?? {
      transactionHash: log.transactionHash,
      blockHash: log.blockHash,
      blockNumber: log.blockNumber,
      status: "0x1",
      logs: [],
    };
    receipt.logs.push(log);
    byHash.set(log.transactionHash, receipt);
  }
  return [...byHash.values()];
}

test("independent record-episode model distinguishes gestures by one wallet", () => {
  const result = replay();
  assert.deepEqual(result.values, {
    gestureCount: "4",
    ethSpent: "20",
    cstBurned: "4",
    highestCstPaid: "3",
    enduranceDuration: "8",
    chronoDuration: "10",
    sameGesture: false,
  });
  assert.equal(result.provenance.enduranceGesture, 4);
  assert.equal(result.provenance.chronoGesture, 1);
  assert.equal(result.provenance.enduranceAddress, result.provenance.chronoAddress);
});
test("strict ties retain the earlier Endurance and Chrono gesture", () => {
  const repeated = recordEpisodes(
    [0, 10, 20].map((timestamp) => ({ timestamp, address: A })),
    30,
  );
  assert.equal(repeated.endurance.gesture, 1);
  assert.equal(repeated.chrono.gesture, 1);
  assert.equal(repeated.chrono.chronoDuration, 30n);
  const chronoTie = recordEpisodes(
    [
      { timestamp: 0, address: A },
      { timestamp: 2, address: B },
    ],
    8,
  );
  assert.equal(chronoTie.endurance.gesture, 2);
  assert.equal(chronoTie.chrono.gesture, 1);
  assert.equal(chronoTie.chrono.chronoDuration, 4n);
});
test("actual closing timestamp and repeated timestamp gestures are preserved", () => {
  const result = replay();
  assert.equal(result.provenance.finalizedAt, "120");
  assert.equal(result.values.enduranceDuration, "8"); // event countdown was119
  const repeated = recordEpisodes(
    [
      { timestamp: 0, address: A },
      { timestamp: 0, address: B },
      { timestamp: 2, address: A },
    ],
    3,
  );
  assert.equal(repeated.endurance.gesture, 2);
  assert.equal(repeated.endurance.enduranceDuration, 2n);
  assert.throws(() => recordEpisodes([{ timestamp: 2, address: A }], 1), /chronological/);
});
test("canonical evidence commitments are independent of RPC ordering", () => {
  const data = history();
  assert.deepEqual(replay(data), replay({ ...data, logs: data.logs.toReversed() }));
  assert.equal(historyHash(canonicalLogs(data.logs)), replay(data).provenance.eventsHash);
});
test("missing, duplicated, removed, wrong-emitter and mismatched-header events fail closed", () => {
  const data = history();
  assert.throws(
    () => replay({ ...data, logs: data.logs.filter((_, index) => index !== 2) }),
    /count/,
  );
  assert.throws(() => replay({ ...data, logs: [...data.logs, data.logs[0]] }), /Duplicate/);
  assert.throws(
    () => replay({ ...data, logs: [{ ...data.logs[0], removed: true }, ...data.logs.slice(1)] }),
    /Removed/,
  );
  assert.throws(
    () => replay({ ...data, logs: [{ ...data.logs[0], address: B }, ...data.logs.slice(1)] }),
    /emitter/,
  );
  assert.throws(
    () =>
      replay({
        ...data,
        headers: { ...data.headers, "0x1": { ...data.headers["0x1"], hash: hash(999) } },
      }),
    /header/,
  );
  assert.throws(
    () =>
      replay({
        ...data,
        headers: { ...data.headers, "0x1": { ...data.headers["0x1"], timestamp: "0x1" } },
      }),
    /timestamp/,
  );
});
test("champion event recipients independently constrain the replay", () => {
  const data = history();
  const index = data.logs.findIndex(
    (log) => log.topics[0] === V2_EVENTS.getEvent("EnduranceChampionPrizePaid").topicHash,
  );
  const changed = structuredClone(data);
  const encoded = V2_EVENTS.encodeEventLog("EnduranceChampionPrizePaid", [2, B, 0, 1]);
  changed.logs[index] = { ...changed.logs[index], ...encoded };
  assert.throws(() => replay(changed), /recipient/);
});
test("native wallet sums and each wallet's last timestamp must agree", () => {
  const result = replay(),
    records = wallets(result);
  assert.match(validateWallets(result, records), /^0x[0-9a-f]{64}$/);
  for (const field of ["ethSpent", "cstBurned", "lastGestureAt"])
    assert.throws(() => validateWallets(result, [{ ...records[0], [field]: "0" }]), /disagrees/);
  assert.throws(() => validateWallets(result, []), /Incomplete/);
  assert.throws(() => validateWallets(result, [{ ...records[0], address: B }]), /unexpected/);
});
test("independent receipts must contain the exact complete event set", () => {
  const data = history(),
    result = replay(data),
    records = receipts(data);
  assert.deepEqual(validateReceipts(result, records), {
    receiptCount: 5,
    receiptEventsHash: result.provenance.eventsHash,
  });
  assert.throws(() => validateReceipts(result, records.slice(1)), /Missing/);
  const wrongStatus = structuredClone(records);
  wrongStatus[0].status = "0x0";
  assert.throws(() => validateReceipts(result, wrongStatus), /successful/);
  const wrongLog = structuredClone(records);
  wrongLog[0].logs[0].data = "0x";
  assert.throws(() => validateReceipts(result, wrongLog), /exact/);
  const extra = structuredClone(records);
  extra[0].logs.push({ ...extra[0].logs[0], logIndex: "0xff" });
  assert.throws(() => validateReceipts(result, extra), /differs/);
});
test("historical reader rejects writes and credentials and validates unordered batch IDs", async () => {
  const calls = [
    { method: "eth_chainId", params: [] },
    { method: "eth_blockNumber", params: [] },
  ];
  let requests = 0;
  const fetcher = async () => {
    requests++;
    return {
      ok: true,
      json: async () => [
        { id: 1, result: "0x2" },
        { id: 0, result: "0xa4b1" },
      ],
    };
  };
  assert.deepEqual(await readRpcBatch(HISTORY_RPCS.logs, calls, { fetcher }), ["0xa4b1", "0x2"]);
  await assert.rejects(
    readRpcBatch("https://rpc.test/API_KEY", calls, { fetcher }),
    /fixed public/,
  );
  await assert.rejects(
    readRpcBatch(HISTORY_RPCS.logs, [{ method: "eth_sendRawTransaction", params: [] }], {
      fetcher,
    }),
    /read-only/,
  );
  assert.equal(requests, 1);
  let attempts = 0,
    waits = 0;
  await assert.rejects(
    readRpcBatch(HISTORY_RPCS.logs, calls, {
      attempts: 2,
      wait: async () => {
        waits++;
      },
      fetcher: async () => {
        attempts++;
        return {
          ok: true,
          json: async () => [
            { id: 0, error: { message: "untrusted remote text" } },
            { id: 0, result: "0x2" },
          ],
        };
      },
    }),
    /bounded retries/,
  );
  assert.equal(attempts, 2);
  assert.equal(waits, 1);
});
