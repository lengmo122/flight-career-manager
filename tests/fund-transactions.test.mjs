import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readAppSource();
const markup = await readFile(new URL("../index.html", import.meta.url), "utf8");

function readFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} source was not found`);
  const nextFunction = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, nextFunction >= 0 ? nextFunction : source.length).trim();
}

let sequence = 0;
const context = {
  cryptoId: () => `fund-${++sequence}`,
  state: { cash: 25000, fundTransactions: [] }
};

vm.runInNewContext([
  readFunction("openingFundTransaction"),
  readFunction("normalizeFundTransactions"),
  readFunction("recordFundTransaction"),
  "globalThis.openingFundTransaction = openingFundTransaction; globalThis.normalizeFundTransactions = normalizeFundTransactions; globalThis.recordFundTransaction = recordFundTransaction;"
].join("\n"), context);

const opening = context.openingFundTransaction(25000, 1000);
assert.equal(opening.amount, 25000);
assert.equal(opening.balance, 25000);
assert.equal(opening.type, "opening");

const migrated = context.normalizeFundTransactions(undefined, 18420);
assert.equal(migrated.length, 1);
assert.equal(migrated[0].title, "历史余额");
assert.equal(migrated[0].balance, 18420);

context.recordFundTransaction({ amount: 5000, type: "mission-income", title: "任务收入", detail: "ZBAA → ZSPD" });
assert.equal(context.state.cash, 30000);
assert.equal(context.state.fundTransactions[0].amount, 5000);
assert.equal(context.state.fundTransactions[0].balance, 30000);

context.recordFundTransaction({ amount: -675, type: "fuel-expense", title: "任务燃油支出" });
assert.equal(context.state.cash, 29325);
assert.equal(context.state.fundTransactions[0].amount, -675);
assert.equal(context.state.fundTransactions[0].balance, 29325);
assert.equal(context.recordFundTransaction({ amount: 0, title: "无变化" }), null);
assert.equal(context.state.fundTransactions.length, 2);

assert.match(source, /fundTransactionList/);
assert.match(markup, /资金使用明细/);
assert.match(source, /type: "aircraft-purchase"/);
assert.match(source, /type: "aircraft-rental"/);
assert.match(source, /type: "aircraft-sale"/);
assert.match(source, /type: "maintenance-expense"/);
assert.match(source, /type: "mission-income"/);
assert.match(source, /type: "fuel-expense"/);

console.log("Fund transactions: migration, income, expenses, balances and transaction categories passed");
