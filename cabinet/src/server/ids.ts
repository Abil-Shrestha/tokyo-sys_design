import { randomBytes } from "node:crypto";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastTime = 0;
let lastRandom: number[] = [];

/**
 * Monotonic ULID: 48-bit timestamp + 80 bits of randomness, Crockford base32.
 * Sortable by creation time and unique across devices, which keeps ids stable
 * when libraries are synced later.
 */
export function ulid(now = Date.now()): string {
  let random: number[];
  if (now <= lastTime && lastRandom.length) {
    now = lastTime;
    random = lastRandom.slice();
    for (let i = random.length - 1; i >= 0; i--) {
      if (random[i] < 31) {
        random[i]++;
        break;
      }
      random[i] = 0;
    }
  } else {
    const bytes = randomBytes(16);
    random = Array.from({ length: 16 }, (_, i) => bytes[i] % 32);
  }
  lastTime = now;
  lastRandom = random;
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return time + random.map((n) => ENCODING[n]).join("");
}

/**
 * Hybrid logical clock. Strings compare lexicographically in causal order:
 * "<ms, 13 digits>-<counter, 4 digits>-<device>".
 */
export class HybridClock {
  private wall = 0;
  private counter = 0;

  constructor(private readonly device: string) {}

  now(): string {
    const t = Date.now();
    if (t > this.wall) {
      this.wall = t;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return this.format();
  }

  /** Advance past a clock value received from another device. */
  observe(remote: string): void {
    const [ms, counter] = remote.split("-");
    const remoteWall = Number(ms);
    const remoteCounter = Number(counter);
    const t = Date.now();
    if (t > this.wall && t > remoteWall) {
      this.wall = t;
      this.counter = 0;
    } else if (remoteWall > this.wall) {
      this.wall = remoteWall;
      this.counter = remoteCounter + 1;
    } else if (remoteWall === this.wall) {
      this.counter = Math.max(this.counter, remoteCounter) + 1;
    } else {
      this.counter++;
    }
  }

  private format(): string {
    return `${String(this.wall).padStart(13, "0")}-${String(this.counter).padStart(4, "0")}-${this.device}`;
  }
}
