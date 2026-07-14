import type { CommitGraphRow } from '../../utils/commitGraph';
import { laneColor } from '../../utils/commitGraph';

// Geometry: each lane is a fixed-width column; the commit dot sits at NODE_Y
// inside a fixed-height top zone (matching the collapsed row header), and
// plain rails continue below it so lines stretch through expanded content.
const LANE_WIDTH = 12;
const NODE_ZONE_HEIGHT = 56;
const NODE_Y = 28;
const NODE_RADIUS = 3.5;
const STROKE_WIDTH = 2;

const laneX = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;

type CommitGraphStripProps = {
  row: CommitGraphRow;
};

export default function CommitGraphStrip({ row }: CommitGraphStripProps) {
  const width = row.laneCount * LANE_WIDTH;
  const nodeX = laneX(row.nodeLane);
  const nodeColor = laneColor(row.nodeLane);

  return (
    <div aria-hidden className="relative shrink-0 self-stretch overflow-hidden" style={{ width }}>
      <svg
        className="absolute left-0 top-0"
        width={width}
        height={NODE_ZONE_HEIGHT}
        fill="none"
      >
        {/* Lines passing straight through the row */}
        {row.passThrough.map((lane) => (
          <path
            key={`pass-${lane}`}
            d={`M ${laneX(lane)} 0 V ${NODE_ZONE_HEIGHT}`}
            stroke={laneColor(lane)}
            strokeWidth={STROKE_WIDTH}
          />
        ))}

        {/* The node's own lane arriving from above / continuing below */}
        {row.hasTopContinuation && (
          <path d={`M ${nodeX} 0 V ${NODE_Y}`} stroke={nodeColor} strokeWidth={STROKE_WIDTH} />
        )}
        {row.hasParentContinuation && (
          <path d={`M ${nodeX} ${NODE_Y} V ${NODE_ZONE_HEIGHT}`} stroke={nodeColor} strokeWidth={STROKE_WIDTH} />
        )}

        {/* Extra children merging into the node from the row above */}
        {row.inbound.map((lane) => (
          <path
            key={`in-${lane}`}
            d={`M ${laneX(lane)} 0 Q ${laneX(lane)} ${NODE_Y} ${nodeX} ${NODE_Y}`}
            stroke={laneColor(lane)}
            strokeWidth={STROKE_WIDTH}
          />
        ))}

        {/* Extra parents branching out of the node toward the row below */}
        {row.outbound.map((lane) => (
          <path
            key={`out-${lane}`}
            d={`M ${nodeX} ${NODE_Y} Q ${laneX(lane)} ${NODE_Y} ${laneX(lane)} ${NODE_ZONE_HEIGHT}`}
            stroke={laneColor(lane)}
            strokeWidth={STROKE_WIDTH}
          />
        ))}

        {/* Commit dot — slightly larger for merge/fork points */}
        <circle
          cx={nodeX}
          cy={NODE_Y}
          r={row.inbound.length > 0 || row.outbound.length > 0 ? NODE_RADIUS + 0.5 : NODE_RADIUS}
          fill={nodeColor}
        />
      </svg>

      {/* Rails continuing below the node zone (through expanded content) */}
      {row.bottomLanes.map((lane) => (
        <div
          key={`rail-${lane}`}
          className="absolute"
          style={{
            left: laneX(lane) - STROKE_WIDTH / 2,
            top: NODE_ZONE_HEIGHT,
            bottom: 0,
            width: STROKE_WIDTH,
            backgroundColor: laneColor(lane),
          }}
        />
      ))}
    </div>
  );
}
