import process from "node:process";

const environment = process.argv[2];
if (environment !== "mainnet") {
  throw new Error("This guard only handles the mainnet seed prohibition");
}

throw new Error(
  "MAINNET_DATABASE_SEED_PROHIBITED: mainnet data must originate from reviewed migrations and canonical ingestion",
);
