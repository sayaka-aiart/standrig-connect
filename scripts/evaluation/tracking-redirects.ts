import { parameterDefinitionsForRig } from '@core/parameters';
import { pendulumSettingsOverwriting, pendulumSettledGain } from '@core/pendulumPhysics';
import { createDefaultTracking } from '@core/tracking';

/**
 * Connect's inputs (camera tracking, idle sway, the demo pose, motions, the parameter API) write
 * StandRig's standard parameters. Two kinds of rig never see such a write:
 * - a rig that names the mouth ParamMouthOpenY has no ParamMouthOpen keyforms;
 * - a rig whose pendulum physics overwrites ParamAngleX and the like every frame from a
 *   pendulum fed by inputs of its own (AngleX, PositionX, LeanInput, ...).
 * Each frame, whatever moved such a standard parameter away from its default is added to the parameter
 * the model listens to. The choice is the one StandRig's default tracking makes: the overwriting
 * pendulum's largest-weight input that no pendulum writes, that no earlier standard parameter took and
 * that the output follows when settled; mirrored where the pendulum mirrors it, rescaled between ranges.
 * The pendulum then shapes the response the way the model's author set it up.
 *
 * A rig that carries its own tracking setup (rig.tracking, saved by its author)
 * decides instead: the head and body angles go wherever that setup sends their tracking source,
 * possibly to several inputs (head pitch to AngleY and PositionY), scaled by the setup's gain relative to
 * StandRig's default for the standard parameter. A source the setup leaves out drives nothing.
 */
export interface TrackingRedirect {
  from: string;
  to: string;
  /** Change of `to` per unit change of `from`. */
  factor: number;
  fromDefault: number;
  min: number;
  max: number;
  /** Through a pendulum input: only while physics runs (without it the standard parameter works directly). */
  viaPendulum: boolean;
}

/** The parameters Connect's tracking, idle and demo layers write, in StandRig's default-tracking order. */
const STANDARD_PARAMETERS = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ', 'ParamMouthOpen', 'ParamMouthForm', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeBallX', 'ParamEyeBallY'];
const ALTERNATE_NAMES: Record<string, string> = { ParamMouthOpen: 'ParamMouthOpenY' };
const MINIMUM_PENDULUM_GAIN = 1e-6;
/** StandRig's tracking source behind each angle parameter Connect writes. */
const ANGLE_SOURCES: Record<string, string> = { ParamAngleX: 'faceYaw', ParamAngleY: 'facePitch', ParamAngleZ: 'faceRoll', ParamBodyAngleX: 'bodyYaw', ParamBodyAngleY: 'bodyPitch' };

/** StandRig's default scale from each angle source to its standard parameter (range -30..30). */
function defaultAngleScales(rig: any): Map<string, number> {
  const parameters = Object.keys(ANGLE_SOURCES).map((id) => ({ id, label: id, min: -30, max: 30, default: 0 }));
  const tracking = createDefaultTracking({ ...rig, parameters, physics: { enabled: false, chains: [] } });
  return new Map(tracking.mappings.filter((mapping: any) => ANGLE_SOURCES[mapping.parameter] === mapping.source).map((mapping: any) => [mapping.source, mapping.scale]));
}

export function trackingRedirects(rig: any): TrackingRedirect[] {
  const authored = new Map<string, any>((rig.parameters ?? []).map((parameter: any) => [parameter.id, parameter]));
  const ranges = new Map<string, any>(parameterDefinitionsForRig(rig).map((parameter: any) => [parameter.id, parameter]));
  const pendulum = rig.physics?.enabled ? rig.physics.pendulum : undefined;
  const written = new Set<string>();
  for (const setting of pendulum?.settings ?? []) if (setting.enabled !== false) for (const output of setting.outputs) written.add(output.parameter);
  const claimed = new Set<string>();
  const redirects: TrackingRedirect[] = [];
  const authorMappings: any[] | undefined = Array.isArray(rig.tracking?.mappings) && rig.tracking.mappings.length ? rig.tracking.mappings : undefined;
  const angleScales = authorMappings ? defaultAngleScales(rig) : undefined;
  for (const requested of STANDARD_PARAMETERS) {
    let parameter = requested;
    const alternateName = ALTERNATE_NAMES[parameter];
    if (alternateName && !authored.has(parameter) && authored.has(alternateName)) parameter = alternateName;
    const source = ANGLE_SOURCES[requested];
    if (source && authorMappings && pendulum?.settings?.length && pendulumSettingsOverwriting(pendulum, parameter).length) {
      const mapped = authorMappings.filter((mapping) => mapping.enabled !== false && mapping.source === source);
      const targets = mapped.filter((mapping) => mapping.parameter !== requested && authored.has(mapping.parameter) && Number.isFinite(mapping.scale));
      const scale = angleScales!.get(source), from = ranges.get(requested);
      // Left out by the setup: nothing to drive. Only the overwritten parameter itself (a setup saved
      // before such models were understood): fall through to the pendulum's own input.
      if (!mapped.length) continue;
      if (targets.length && scale && from) {
        for (const mapping of targets) {
          const to = ranges.get(mapping.parameter);
          if (!to) continue;
          claimed.add(mapping.parameter);
          redirects.push({ from: requested, to: mapping.parameter, factor: (mapping.scale / scale) * (mapping.invert ? -1 : 1), fromDefault: from.default, min: to.min, max: to.max, viaPendulum: true });
        }
        continue;
      }
    }
    let target = parameter, mirrored = false, viaPendulum = false;
    if (pendulum?.settings?.length) {
      search: for (const setting of pendulumSettingsOverwriting(pendulum, parameter)) {
        const candidates = setting.inputs
          .filter((input: any) => authored.has(input.parameter) && !written.has(input.parameter) && !claimed.has(input.parameter))
          .sort((a: any, b: any) => Math.abs(b.weight) - Math.abs(a.weight));
        for (const candidate of candidates) {
          const gain = pendulumSettledGain(pendulum, ranges, setting, candidate.parameter, parameter);
          if (!(Math.abs(gain) > MINIMUM_PENDULUM_GAIN)) continue;
          target = candidate.parameter;
          mirrored = gain < 0;
          viaPendulum = true;
          break search;
        }
      }
    }
    claimed.add(target);
    if (target === requested) continue;
    const from = ranges.get(requested), to = ranges.get(target);
    if (!from || !to) continue;
    const span = from.max - from.min;
    const factor = (span !== 0 ? (to.max - to.min) / span : 1) * (mirrored ? -1 : 1);
    redirects.push({ from: requested, to: target, factor, fromDefault: from.default, min: to.min, max: to.max, viaPendulum });
  }
  return redirects;
}

/** Adds each redirected parameter's change from its default to its target, in place. */
export function applyTrackingRedirects(values: Record<string, number>, redirects: readonly TrackingRedirect[], physics: boolean): void {
  for (const redirect of redirects) {
    if (redirect.viaPendulum && !physics) continue;
    const value = values[redirect.from];
    if (value === undefined || value === redirect.fromDefault) continue;
    const base = values[redirect.to] ?? 0;
    values[redirect.to] = Math.min(redirect.max, Math.max(redirect.min, base + (value - redirect.fromDefault) * redirect.factor));
  }
}
