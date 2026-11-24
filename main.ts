// tiny-vm: an interpreter for make.fun's tiny stack ISA (ISA.md), Node 22 stdlib only.
// Reads /input/<id>/{program.bin,input.bin} for i001..i040 and writes
// /output/<id>/{stdout.bin,exit.txt}. Deterministic; no network, no clock.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function run(p, q) {
  const n = p.length;
  const D = new Int32Array(256); // data stack
  const C = new Int32Array(64); // call stack
  const M = new Int32Array(256); // memory
  const O = new Uint8Array(65536); // output
  let s = 0, c = 0, pc = 0, i = 0, ol = 0, budget = 1000000;
  const R = (e) => [O.slice(0, ol), e];
  for (;;) {
    // Hot loop, no step-limit check inside it: run at most 1024 steps per
    // chunk, the chunk budget enforcing the 1,000,000-step trap (exit 10)
    // structurally. The pc check is folded into the fetch: p[pc] is
    // undefined exactly when pc is outside the program (exit 9).
    let e = budget < 1024 ? budget : 1024;
    budget -= e;
    while (e-- > 0) {
      const k = p[pc];
      if (k === undefined) return R(9);
    switch (k) {
      case 0x00: return R(0);
      case 0x01:
        if (pc + 1 >= n) return R(9);
        if (s === 256) return R(3);
        D[s++] = (p[pc + 1] << 24) >> 24;
        pc += 2;
        break;
      case 0x02:
        if (pc + 4 >= n) return R(9);
        if (s === 256) return R(3);
        D[s++] = p[pc + 1] | (p[pc + 2] << 8) | (p[pc + 3] << 16) | (p[pc + 4] << 24);
        pc += 5;
        break;
      case 0x03:
        if (s < 1) return R(2);
        s--; pc++;
        break;
      case 0x04:
        if (s < 1) return R(2);
        if (s === 256) return R(3);
        D[s] = D[s - 1]; s++; pc++;
        break;
      case 0x05: {
        if (s < 2) return R(2);
        const x = D[s - 1]; D[s - 1] = D[s - 2]; D[s - 2] = x; pc++;
        break;
      }
      case 0x06:
        if (s < 2) return R(2);
        if (s === 256) return R(3);
        D[s] = D[s - 2]; s++; pc++;
        break;
      case 0x07: {
        if (s < 3) return R(2);
        const a = D[s - 3]; D[s - 3] = D[s - 2]; D[s - 2] = D[s - 1]; D[s - 1] = a; pc++;
        break;
      }
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        if (s < 2) return R(2);
        const b = D[s - 1], a = D[s - 2];
        let r;
        switch (k) {
          case 0x10: r = (a + b) | 0; break;
          case 0x11: r = (a - b) | 0; break;
          case 0x12: r = Math.imul(a, b); break;
          case 0x13: if (!b) return R(4); r = (a / b) | 0; break;
          case 0x14: if (!b) return R(4); r = (a % b) | 0; break;
          case 0x15: if (!b) return R(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; break;
          case 0x16: if (!b) return R(4); r = ((a >>> 0) % (b >>> 0)) | 0; break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break;
          case 0x1d: r = a >> (b & 31); break;
          case 0x1e: r = (a >>> (b & 31)) | 0; break;
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break;
          default: r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        }
        D[s - 2] = r; s--; pc++;
        break;
      }
      case 0x17:
        if (s < 1) return R(2);
        D[s - 1] = (-D[s - 1]) | 0; pc++;
        break;
      case 0x1b:
        if (s < 1) return R(2);
        D[s - 1] = ~D[s - 1]; pc++;
        break;
      case 0x30: case 0x31: case 0x32: {
        if (pc + 2 >= n) return R(9);
        const rel = ((p[pc + 1] | (p[pc + 2] << 8)) << 16) >> 16;
        pc += 3;
        if (k === 0x30) { pc += rel; break; }
        if (s < 1) return R(2);
        if ((k === 0x31) === (D[--s] === 0)) pc += rel;
        break;
      }
      case 0x33:
        if (pc + 2 >= n) return R(9);
        if (c === 64) return R(7);
        C[c++] = pc + 3; pc = p[pc + 1] | (p[pc + 2] << 8);
        break;
      case 0x34:
        if (c === 0) return R(8);
        pc = C[--c];
        break;
      case 0x40: {
        if (s < 1) return R(2);
        const a = D[s - 1];
        if (a < 0 || a > 255) return R(6);
        D[s - 1] = M[a]; pc++;
        break;
      }
      case 0x41: {
        if (s < 2) return R(2);
        const a = D[s - 1], v = D[s - 2];
        if (a < 0 || a > 255) return R(6);
        s -= 2; M[a] = v; pc++;
        break;
      }
      case 0x50: {
        if (s < 1) return R(2);
        const d = String(D[s - 1]);
        if (ol + d.length > 65536) return R(11);
        s--;
        for (let j = 0; j < d.length; j++) O[ol++] = d.charCodeAt(j);
        pc++;
        break;
      }
      case 0x51:
        if (s < 1) return R(2);
        if (ol + 1 > 65536) return R(11);
        O[ol++] = D[--s] & 255; pc++;
        break;
      case 0x52:
        if (s === 256) return R(3);
        D[s++] = i < q.length ? q[i++] : -1; pc++;
        break;
      case 0x53:
        if (s < 1) return R(2);
        return R(D[--s] & 255);
      default: return R(5);
    }
    }
    if (budget === 0) return R(10);
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(readFileSync(join(I, id, 'program.bin')), readFileSync(join(I, id, 'input.bin')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r[0]);
  writeFileSync(join(O, id, 'exit.txt'), r[1] + '\n');
}
