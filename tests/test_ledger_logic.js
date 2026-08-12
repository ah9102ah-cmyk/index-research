const fs = require("fs");
const vm = require("vm");

const script = fs.readFileSync("assets/hs300.js", "utf8");
for (const token of [
  'const STORAGE_KEY = "indexResearch.hs300.ledger.v1"',
  'const FUND_CODE = "460300"',
  'localStorage.setItem(STORAGE_KEY',
  'shares * quote.nav',
  'Number(ledger.totalPrincipal) - reserveCash - fundCost',
]) {
  if (!script.includes(token)) throw new Error(`missing required token: ${token}`);
}
new vm.Script(script);

const totalPrincipal = 100000;
const reserveCash = 40000;
const initialCost = 39571.42;
const initialProfit = 1312.77;
const nav = 1.1873;
const marketValue = initialCost + initialProfit;
const shares = marketValue / nav;
const buildCash = totalPrincipal - reserveCash - initialCost;
const totalValue = shares * nav + reserveCash + buildCash;
const weight = shares * nav / totalValue;

function close(actual, expected, eps = 1e-8) {
  if (Math.abs(actual - expected) > eps) throw new Error(`${actual} != ${expected}`);
}
close(marketValue, 40884.19);
close(shares, 34434.5910890255);
close(buildCash, 20428.58);
close(totalValue, 101312.77);
close(weight, 0.403544291603122);

console.log("ledger logic tests: PASS");
