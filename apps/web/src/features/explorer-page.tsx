import activity from "../data/activity.json";
import markets from "../data/markets.json";
import { MetricStrip } from "../components/protocol/metric-strip";
import { Badge, Panel } from "../components/ui/primitives";

export function ExplorerPage() {
  return (
    <main className="page-container">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ZKBLAST / PROTOCOL EXPLORER</span>
          <h1>Observe every movement.</h1>
          <p>
            Full explorer presentation using explicitly labelled local
            demonstration records.
          </p>
        </div>
        <Badge>DEMO STREAM</Badge>
      </div>
      <MetricStrip />
      <div className="explorer-grid">
        <Panel className="volume-panel">
          <div className="panel-title">
            <h2>Volume / 24H</h2>
            <span>DEMO INDEX</span>
          </div>
          <div className="volume-chart">
            {[
              22, 35, 29, 48, 41, 62, 55, 72, 68, 83, 78, 92, 74, 81, 69, 88,
              94, 76, 85, 97, 89, 93, 86, 99,
            ].map((height, index) => (
              <i key={index} style={{ height: `${height}%` }} />
            ))}
          </div>
        </Panel>
        <Panel>
          <div className="panel-title">
            <h2>Pool allocation</h2>
          </div>
          {markets.pools.map((pool) => (
            <div className="allocation-row" key={pool.id}>
              <span>{pool.pair}</span>
              <i>
                <b style={{ width: `${pool.liquidity}%` }} />
              </i>
              <strong>{pool.liquidity}%</strong>
            </div>
          ))}
        </Panel>
      </div>
      <Panel className="transactions">
        <div className="panel-title">
          <h2>Recent protocol activity</h2>
          <span>AUTO REFRESH / DEMO</span>
        </div>
        <div className="transaction-head">
          <span>TYPE</span>
          <span>ACCOUNT</span>
          <span>MARKET</span>
          <span>AMOUNT</span>
          <span>VALUE</span>
          <span>AGE</span>
        </div>
        {activity.transactions.map((item) => (
          <div className="transaction-row" key={item.id}>
            <Badge muted>{item.type}</Badge>
            <code>{item.account}</code>
            <b>{item.market}</b>
            <span>{item.amount}</span>
            <span>{item.value}</span>
            <small>{item.time}</small>
          </div>
        ))}
      </Panel>
    </main>
  );
}
