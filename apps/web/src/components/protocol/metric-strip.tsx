import activity from "../../data/activity.json";

export function MetricStrip() {
  return (
    <div className="metric-strip">
      {activity.metrics.map((item) => (
        <div key={item.label}>
          <small>{item.label}</small>
          <strong>{item.value}</strong>
          <span>{item.change}</span>
        </div>
      ))}
    </div>
  );
}
