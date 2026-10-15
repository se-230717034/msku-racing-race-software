import type { KinematicsSweepResponse } from "@msku/contracts";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const toDegrees = (radians: number): number => radians * 180 / Math.PI;

export function KinematicsCharts({
  sweep,
  selectedTravelM,
}: {
  sweep: KinematicsSweepResponse;
  selectedTravelM: number;
}) {
  const data = sweep.states.map((state) => ({
    travelMm: state.travelM * 1000,
    camberDeg: state.metrics ? toDegrees(state.metrics.camberRad) : null,
    toeDeg: state.metrics ? toDegrees(state.metrics.toeRad) : null,
    rollCenterMm: state.metrics?.rollCenterHeightM == null ? null : state.metrics.rollCenterHeightM * 1000,
    trackChangeMm: state.metrics ? state.metrics.trackChangeM * 1000 : null,
  }));
  const selectedTravelMm = selectedTravelM * 1000;

  return (
    <div className="kinematics-charts">
      <section className="chart-card">
        <div className="chart-heading"><span>ALIGNMENT</span><b>deg vs wheel travel</b></div>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#252b36" strokeDasharray="2 4" />
            <XAxis dataKey="travelMm" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: "#727c8d", fontSize: 9 }} unit=" mm" />
            <YAxis tick={{ fill: "#727c8d", fontSize: 9 }} unit="°" width={52} />
            <Tooltip contentStyle={{ background: "#11151c", border: "1px solid #343c49", fontSize: 10 }} labelFormatter={(value) => `${Number(value).toFixed(1)} mm`} />
            <Legend wrapperStyle={{ fontSize: 9 }} />
            <ReferenceLine x={selectedTravelMm} stroke="#ef233c" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="camberDeg" name="Camber" stroke="#f43f5e" dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="toeDeg" name="Toe" stroke="#60a5fa" dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>
      <section className="chart-card">
        <div className="chart-heading"><span>GEOMETRY MIGRATION</span><b>mm vs wheel travel</b></div>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#252b36" strokeDasharray="2 4" />
            <XAxis dataKey="travelMm" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: "#727c8d", fontSize: 9 }} unit=" mm" />
            <YAxis tick={{ fill: "#727c8d", fontSize: 9 }} unit=" mm" width={58} />
            <Tooltip contentStyle={{ background: "#11151c", border: "1px solid #343c49", fontSize: 10 }} labelFormatter={(value) => `${Number(value).toFixed(1)} mm`} />
            <Legend wrapperStyle={{ fontSize: 9 }} />
            <ReferenceLine x={selectedTravelMm} stroke="#ef233c" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="rollCenterMm" name="Roll centre height" stroke="#a78bfa" dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="trackChangeMm" name="Track change" stroke="#4ade80" dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}

