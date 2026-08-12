const fs = require("fs");
const vm = require("vm");

const script = fs.readFileSync("assets/hs300.js", "utf8");
for (const token of [
  'const CACHE_KEY = "indexResearch.hs300.remoteLedger.cache.v1"',
  'const FUND_CODE = "460300"',
  'const LEDGER_URL = "../data/ledger-460300.json"',
  'const ISSUE_URL = "https://github.com/ah9102ah-cmyk/index-research/issues/new"',
  'shares * quote.nav',
  'Number(ledger.totalPrincipal) - reserveCash - fundCost',
  'index-research-ledger-v1:',
]) {
  if (!script.includes(token)) throw new Error(`missing required token: ${token}`);
}
new vm.Script(script);

const ledger = JSON.parse(fs.readFileSync("data/ledger-460300.json", "utf8"));
if (ledger.fundCode !== "460300" || ledger.version !== 1) throw new Error("invalid remote ledger identity");
if (ledger.totalPrincipal !== 100000 || ledger.reserveCash !== 40000) throw new Error("invalid capital split");
if (ledger.transactions.length !== 1 || ledger.transactions[0].type !== "initial") throw new Error("invalid initial history");

const totalPrincipal = ledger.totalPrincipal;
const reserveCash = ledger.reserveCash;
const initialCost = ledger.transactions[0].amount;
const nav = 1.1873;
const shares = ledger.transactions[0].shares;
const marketValue = shares * nav;
const buildCash = totalPrincipal - reserveCash - initialCost;
const totalValue = marketValue + reserveCash + buildCash;
const weight = marketValue / totalValue;

function close(actual, expected, eps = 1e-8) {
  if (Math.abs(actual - expected) > eps) throw new Error(`${actual} != ${expected}`);
}
close(marketValue, 40884.19);
close(shares, 34434.5910890255);
close(buildCash, 20428.58);
close(totalValue, 101312.77);
close(weight, 0.403544291603122);

console.log("remote ledger frontend tests: PASS");
