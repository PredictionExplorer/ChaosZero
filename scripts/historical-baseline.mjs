import { AbiCoder, Interface, getAddress, keccak256, toUtf8Bytes } from "ethers";

export const HISTORY_GAME = "0x6a714Ae7B5b6eA520F6BCA23d2E609C4Fd5863F2";
export const HISTORY_CST = "0xAD91843e6A58Ba560F577E676986AFb1dba6FBA0";
export const V2_EVENTS = new Interface([
  "event FirstBidPlacedInRound(uint256 indexed roundNum,uint256 timeStamp)",
  "event BidPlaced(uint256 indexed roundNum,address indexed lastBidderAddress,int256 paidEthPrice,int256 paidCstPrice,int256 indexed randomWalkNftId,string message,uint256 bidCstRewardAmount,uint256 cstDutchAuctionDuration,uint256 mainPrizeTime)",
  "event MainPrizeClaimed(uint256 indexed roundNum,address indexed beneficiaryAddress,uint256 ethPrizeAmount,uint256 cstPrizeAmount,uint256 indexed prizeCosmicSignatureNftId,uint256 timeoutTimeToWithdrawSecondaryPrizes)",
  "event EnduranceChampionPrizePaid(uint256 indexed roundNum,address indexed enduranceChampionAddress,uint256 cstPrizeAmount,uint256 indexed prizeCosmicSignatureNftId)",
  "event ChronoWarriorPrizePaid(uint256 indexed roundNum,uint256 winnerIndex,address indexed chronoWarriorAddress,uint256 ethPrizeAmount,uint256 cstPrizeAmount,uint256 indexed prizeCosmicSignatureNftId)",
]);
export const V3_READS = new Interface([
  "function roundNum() view returns (uint256)",
  "function token() view returns (address)",
  "function roundStats(uint256) view returns (uint256 numBids,uint256 numCstBids,uint256 totalSpentEthAmount,uint256 totalSpentCstAmount,uint256 maxEthBidPrice,uint256 maxCstBidPrice,uint256 enduranceChampionDuration,uint256 chronoWarriorDuration,uint256 flags)",
  "function biddersInfo(uint256,address) view returns (uint256 totalSpentEthAmount,uint256 totalSpentCstAmount,uint256 lastBidTimeStamp)",
]);

function requireFact(condition, message) {
  if (!condition) throw new Error(message);
}
const lower = (value) => value.toLowerCase();
const quantity = (value) => BigInt(value).toString();
const hashPattern = /^0x[0-9a-f]{64}$/i;
const bytesPattern = /^0x(?:[0-9a-f]{2})*$/i;

export function canonicalLogs(logs) {
  const normalized = logs.map((log) => {
    requireFact(log.removed === false, "Removed or unconfirmed event");
    requireFact(
      hashPattern.test(log.transactionHash) && hashPattern.test(log.blockHash),
      "Invalid event hash",
    );
    requireFact(
      Array.isArray(log.topics) &&
        log.topics.every((topic) => hashPattern.test(topic)) &&
        bytesPattern.test(log.data),
      "Invalid event payload",
    );
    const result = {
      blockNumber: quantity(log.blockNumber),
      transactionIndex: quantity(log.transactionIndex),
      logIndex: quantity(log.logIndex),
      blockHash: lower(log.blockHash),
      transactionHash: lower(log.transactionHash),
      address: lower(getAddress(log.address)),
      topics: log.topics.map(lower),
      data: lower(log.data),
    };
    requireFact(
      [result.blockNumber, result.transactionIndex, result.logIndex].every(
        (value) => BigInt(value) >= 0n,
      ),
      "Negative event position",
    );
    return result;
  });
  normalized.sort((a, b) => {
    for (const field of ["blockNumber", "transactionIndex", "logIndex"]) {
      if (BigInt(a[field]) !== BigInt(b[field]))
        return BigInt(a[field]) < BigInt(b[field]) ? -1 : 1;
    }
    return 0;
  });
  const seen = new Set();
  for (const log of normalized) {
    const id = `${log.blockNumber}:${log.logIndex}`;
    requireFact(!seen.has(id), "Duplicate event position");
    seen.add(id);
  }
  return normalized;
}

export function historyHash(value) {
  return keccak256(toUtf8Bytes(JSON.stringify(value)));
}

/** Independent episode formulation: each strict Endurance record owns the
 * interval from its promotion instant to the next promotion (or actual close).
 * This does not reuse the market's state-machine implementation.
 */
export function recordEpisodes(gestures, closedAt) {
  requireFact(gestures.length > 0, "Empty gesture history");
  const end = BigInt(closedAt);
  const episodes = [];
  let longest = -1n;
  for (let index = 0; index < gestures.length; index++) {
    const start = BigInt(gestures[index].timestamp);
    const next = index + 1 === gestures.length ? end : BigInt(gestures[index + 1].timestamp);
    requireFact(next >= start, "Gesture timestamps are not chronological");
    const gap = next - start;
    if (gap > longest) {
      const promotedAt = start + (longest < 0n ? 0n : longest);
      if (episodes.length) episodes[episodes.length - 1].endedAt = promotedAt;
      episodes.push({
        gesture: index + 1,
        address: getAddress(gestures[index].address),
        startedAt: promotedAt,
        endedAt: end,
        enduranceDuration: gap,
      });
      longest = gap;
    }
  }
  let chrono;
  for (const episode of episodes) {
    episode.chronoDuration = episode.endedAt - episode.startedAt;
    requireFact(episode.chronoDuration >= 0n, "Negative record tenure");
    if (!chrono || episode.chronoDuration > chrono.chronoDuration) chrono = episode;
  }
  return { endurance: episodes.at(-1), chrono, episodes };
}

/** Validate complete ordered round-2 logs against independent header data.
 * This is reproducible off-chain evidence, not a receipts-trie proof verifier.
 */
export function reconstructBaseline(
  rawLogs,
  headerMap,
  { expectedCount, game = HISTORY_GAME, round = 2n } = {},
) {
  const logs = canonicalLogs(rawLogs);
  const headers = new Map(
    Object.values(headerMap).map((header) => [quantity(header.number), header]),
  );
  const usedHeaders = new Map();
  const decoded = [];
  for (const log of logs) {
    requireFact(log.address === lower(game), "Unexpected event emitter");
    const header = headers.get(log.blockNumber);
    requireFact(
      header && lower(header.hash) === log.blockHash,
      "Event does not match canonical block header",
    );
    for (const field of ["hash", "stateRoot", "receiptsRoot", "parentHash"])
      requireFact(hashPattern.test(header[field]), "Invalid block header");
    const canonicalHeader = {
      number: quantity(header.number),
      hash: lower(header.hash),
      timestamp: quantity(header.timestamp),
      parentHash: lower(header.parentHash),
      stateRoot: lower(header.stateRoot),
      receiptsRoot: lower(header.receiptsRoot),
    };
    usedHeaders.set(log.blockNumber, canonicalHeader);
    let event;
    try {
      event = V2_EVENTS.parseLog(log);
    } catch {
      event = null;
    }
    if (event) {
      requireFact(event.args.roundNum === round, "Mixed round event history");
      decoded.push({
        ...log,
        name: event.name,
        args: event.args,
        timestamp: BigInt(header.timestamp),
      });
    }
  }
  const named = (name) => decoded.filter((event) => event.name === name);
  const first = named("FirstBidPlacedInRound");
  const close = named("MainPrizeClaimed");
  const endurance = named("EnduranceChampionPrizePaid");
  const chrono = named("ChronoWarriorPrizePaid");
  const bids = named("BidPlaced");
  requireFact(
    first.length === 1 && close.length === 1 && endurance.length === 1 && chrono.length === 1,
    "Missing or duplicate round boundary/champion event",
  );
  requireFact(
    bids.length > 0 &&
      (expectedCount === undefined || BigInt(bids.length) === BigInt(expectedCount)),
    "Gesture count does not match permanent on-chain count",
  );
  requireFact(
    first[0].timestamp === first[0].args.timeStamp,
    "First gesture event timestamp does not match its header",
  );
  requireFact(
    first[0].transactionHash === bids[0].transactionHash &&
      BigInt(first[0].logIndex) < BigInt(bids[0].logIndex),
    "First gesture boundary mismatch",
  );
  requireFact(
    decoded.indexOf(first[0]) < decoded.indexOf(bids[0]) &&
      decoded.indexOf(bids.at(-1)) < decoded.indexOf(close[0]),
    "Gestures outside round boundaries",
  );
  requireFact(
    endurance[0].transactionHash === close[0].transactionHash &&
      chrono[0].transactionHash === close[0].transactionHash,
    "Champion events are not from the closing transaction",
  );
  let ethSpent = 0n,
    cstBurned = 0n,
    highestCstPaid = 0n;
  const wallets = new Map();
  const gestures = bids.map((bid, index) => {
    const { paidEthPrice, paidCstPrice } = bid.args;
    const isEth = paidEthPrice >= 0n && paidCstPrice === -1n;
    const isCst = paidCstPrice >= 0n && paidEthPrice === -1n;
    requireFact(isEth !== isCst, "Invalid paid amount/type sentinel");
    requireFact(index !== 0 || (isEth && paidEthPrice > 0n), "Invalid first gesture");
    const bidder = getAddress(bid.args.lastBidderAddress);
    const wallet = wallets.get(bidder) ?? { ethSpent: 0n, cstBurned: 0n, lastGestureAt: 0n };
    if (isEth) {
      ethSpent += paidEthPrice;
      wallet.ethSpent += paidEthPrice;
    } else {
      cstBurned += paidCstPrice;
      wallet.cstBurned += paidCstPrice;
      if (paidCstPrice > highestCstPaid) highestCstPaid = paidCstPrice;
    }
    wallet.lastGestureAt = bid.timestamp;
    wallets.set(bidder, wallet);
    return { address: bidder, timestamp: bid.timestamp };
  });
  const records = recordEpisodes(gestures, close[0].timestamp);
  requireFact(
    records.endurance.address === getAddress(endurance[0].args.enduranceChampionAddress),
    "Endurance replay disagrees with prize recipient",
  );
  requireFact(
    records.chrono.address === getAddress(chrono[0].args.chronoWarriorAddress),
    "Chrono replay disagrees with prize recipient",
  );
  const values = {
    gestureCount: bids.length.toString(),
    ethSpent: ethSpent.toString(),
    cstBurned: cstBurned.toString(),
    highestCstPaid: highestCstPaid.toString(),
    enduranceDuration: records.endurance.enduranceDuration.toString(),
    chronoDuration: records.chrono.chronoDuration.toString(),
    sameGesture: records.endurance.gesture === records.chrono.gesture,
  };
  const baselineHash = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "tuple(uint256,uint256,uint256,uint256,uint256,uint256,bool)"],
      [game, round, Object.values(values)],
    ),
  );
  return {
    values,
    baselineHash,
    wallets,
    logs,
    headers: [...usedHeaders.values()],
    provenance: {
      firstBlock: first[0].blockNumber,
      finalBlock: close[0].blockNumber,
      firstBlockHash: first[0].blockHash,
      finalBlockHash: close[0].blockHash,
      firstTransactionHash: first[0].transactionHash,
      closeTransactionHash: close[0].transactionHash,
      firstGestureAt: first[0].timestamp.toString(),
      finalizedAt: close[0].timestamp.toString(),
      eventsHash: historyHash(logs),
      headersHash: historyHash([...usedHeaders.values()]),
      eventCount: logs.length,
      gestureCount: bids.length,
      headerCount: usedHeaders.size,
      uniqueWalletCount: wallets.size,
      enduranceGesture: records.endurance.gesture,
      chronoGesture: records.chrono.gesture,
      enduranceAddress: records.endurance.address,
      chronoAddress: records.chrono.address,
    },
  };
}

export function validateWallets(reconstruction, records) {
  requireFact(
    records.length === reconstruction.wallets.size,
    "Incomplete wallet-state cross-check",
  );
  const checked = new Set();
  for (const record of records) {
    const address = getAddress(record.address);
    const expected = reconstruction.wallets.get(address);
    requireFact(expected && !checked.has(address), "Duplicate or unexpected wallet state");
    checked.add(address);
    requireFact(
      BigInt(record.ethSpent) === expected.ethSpent &&
        BigInt(record.cstBurned) === expected.cstBurned &&
        BigInt(record.lastGestureAt) === expected.lastGestureAt,
      "Wallet storage disagrees with event payments/timestamp",
    );
  }
  return historyHash(
    records
      .map((record) => ({
        address: getAddress(record.address),
        ethSpent: quantity(record.ethSpent),
        cstBurned: quantity(record.cstBurned),
        lastGestureAt: quantity(record.lastGestureAt),
      }))
      .sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase())),
  );
}

export function validateReceipts(reconstruction, receipts) {
  const byHash = new Map(receipts.map((receipt) => [lower(receipt.transactionHash), receipt]));
  const seen = new Set();
  for (const log of reconstruction.logs) {
    const receipt = byHash.get(log.transactionHash);
    requireFact(
      receipt &&
        BigInt(receipt.status) === 1n &&
        lower(receipt.blockHash) === log.blockHash &&
        quantity(receipt.blockNumber) === log.blockNumber,
      "Missing or inconsistent successful receipt",
    );
    seen.add(log.transactionHash);
    const matching = receipt.logs.find((entry) => BigInt(entry.logIndex) === BigInt(log.logIndex));
    requireFact(
      matching && JSON.stringify(canonicalLogs([matching])[0]) === JSON.stringify(log),
      "Receipt does not contain exact canonical event",
    );
  }
  // Require the same complete set of round-indexed game logs, including extras.
  const topic = `0x${2n.toString(16).padStart(64, "0")}`;
  const receiptLogs = receipts
    .filter((receipt) => seen.has(lower(receipt.transactionHash)))
    .flatMap((receipt) =>
      receipt.logs.filter(
        (log) => lower(log.address) === lower(HISTORY_GAME) && lower(log.topics[1] ?? "") === topic,
      ),
    );
  requireFact(
    historyHash(canonicalLogs(receiptLogs)) === reconstruction.provenance.eventsHash,
    "Receipt event set differs from queried event set",
  );
  return { receiptCount: seen.size, receiptEventsHash: historyHash(canonicalLogs(receiptLogs)) };
}
