import Svg, { Rect } from 'react-native-svg';

/**
 * The Forkast fork, redrawn so it can take a colour.
 *
 * The same three tine mark the launcher icon and the native splash already
 * show, which matters: it is the one thing a person has seen before the welcome
 * screen renders, so continuing it is the opposite of decoration. The two
 * shipped PNGs are fixed colours, burnt amber and saffron, and cannot be
 * recoloured, which is the whole reason this exists as geometry instead.
 *
 * Deliberately not a photograph and not an illustration. The guide bans stock
 * imagery twice by name and the repo has never held a single photo; the only
 * images in this app are the user's own meals.
 *
 * A note on colour that is easy to get wrong: never pass the brand saffron to
 * this. A large saffron mark is the brand used as decoration, and it would
 * leave the button underneath with no claim on the one colour that means "you
 * can press this". Ink, at a weight that lets the field behind it show through.
 */

/** The natural proportions of the mark, taken from the shipped splash asset. */
const BOX_W = 440;
const BOX_H = 800;

type MarkProps = {
  /** Height in points. The width follows from the mark's own proportions. */
  size?: number;
  color: string;
  /** Below 1 the field behind shows through, which is how this stays quiet. */
  opacity?: number;
};

export function Mark({ size = 120, color, opacity = 1 }: MarkProps) {
  const width = Math.round((size * BOX_W) / BOX_H);

  return (
    <Svg width={width} height={size} viewBox={`0 0 ${BOX_W} ${BOX_H}`} opacity={opacity}>
      {/* Three tines. Rounded rects rather than one path, because the shape is
          genuinely three bars and a block, and a path would say that less
          clearly to whoever edits this next. */}
      <Rect x={48} y={28} width={82} height={300} rx={41} fill={color} />
      <Rect x={179} y={28} width={82} height={300} rx={41} fill={color} />
      <Rect x={310} y={28} width={82} height={300} rx={41} fill={color} />
      {/* The shoulder the tines meet, overlapping them so the join is solid. */}
      <Rect x={28} y={286} width={384} height={134} rx={62} fill={color} />
      {/* The handle. */}
      <Rect x={178} y={402} width={90} height={362} rx={45} fill={color} />
    </Svg>
  );
}
