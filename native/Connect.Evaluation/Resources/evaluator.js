var StandRigEvaluation = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/types.ts
	var RIG_SCHEMA_VERSION = "0.1.0";
	var PARAMETER_IDS = [
		"ParamAngleX",
		"ParamAngleY",
		"ParamAngleZ",
		"ParamEyeBallX",
		"ParamEyeBallY",
		"ParamBodyAngleX",
		"ParamBodyAngleY",
		"ParamMouthOpen",
		"ParamMouthForm",
		"ParamMouthSmile",
		"ParamEyeLOpen",
		"ParamEyeROpen"
	];
	var TRANSFORM_PROPERTIES = [
		"x",
		"y",
		"rotation",
		"scaleX",
		"scaleY",
		"opacity"
	];
	var WARP_BINDING_PROPERTIES = [
		"warp.bendX",
		"warp.bendY",
		"warp.taperX",
		"warp.taperY"
	];
	var WARP_PIN_BINDING_PROPERTIES = ["offsetX", "offsetY"];
	var PARAMETER_INTERPOLATIONS = [
		"linear",
		"smoothstep",
		"hold",
		"arc",
		"curve"
	];
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/migration.ts
	var CURRENT_RIG_SCHEMA_VERSION = RIG_SCHEMA_VERSION;
	var RigMigrationError = class extends Error {
		code;
		constructor(code, message) {
			super(message);
			this.name = "RigMigrationError";
			this.code = code;
		}
	};
	/**
	* Validates and migrates a serialized rig at the application boundary.
	* The current schema is deliberately returned by reference: migration must
	* not silently normalize or rewrite a model that is already current.
	*/
	function migrateRigDocument(value) {
		if (!isRecord(value)) throw invalid("Rig document must be an object");
		if (typeof value.schemaVersion !== "string" || !value.schemaVersion.trim()) throw invalid("Rig document is missing schemaVersion");
		if (value.schemaVersion !== CURRENT_RIG_SCHEMA_VERSION) throw new RigMigrationError("unsupported-version", `Unsupported rig schemaVersion ${value.schemaVersion}; expected ${CURRENT_RIG_SCHEMA_VERSION}`);
		assertCurrentShape(value);
		return value;
	}
	function assertCurrentShape(value) {
		if (typeof value.name !== "string") throw invalid("Rig document is missing name");
		if (!isRecord(value.stage)) throw invalid("Rig document is missing stage");
		for (const field of [
			"assets",
			"parameters",
			"parts"
		]) if (!Array.isArray(value[field])) throw invalid(`Rig document field ${field} must be an array`);
		if (!isRecord(value.physics)) throw invalid("Rig document is missing physics");
		if (value.deformers !== void 0 && !Array.isArray(value.deformers)) throw invalid("Rig document field deformers must be an array when present");
	}
	function isRecord(value) {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}
	function invalid(message) {
		return new RigMigrationError("invalid-document", message);
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/bindingPreparation.ts
	function prepareRigBindingOrder(rig) {
		for (const part of rig.parts) {
			sortBindings(part.bindings);
			sortMultiBindings(part.multiBindings);
			sortWarpPins(part.warp?.pins);
			for (const binding of part.artMesh?.bindings ?? []) binding.keys.sort((a, b) => a.input - b.input);
			sortArtMeshMultiBindings(part.artMesh?.multiBindings);
		}
		for (const deformer of rig.deformers ?? []) {
			sortBindings(deformer.bindings);
			sortMultiBindings(deformer.multiBindings);
			sortWarpPins(deformer.warp?.pins);
		}
		return rig;
	}
	function sortBindings(bindings) {
		for (const binding of bindings ?? []) binding.keys.sort((a, b) => a.input - b.input);
	}
	function sortMultiBindings(bindings) {
		for (const binding of bindings ?? []) sortMultiKeyforms(binding);
	}
	function sortMultiKeyforms(binding) {
		const [x, y] = binding.parameters;
		binding.keyforms.sort((a, b) => (a.inputs[x] ?? 0) - (b.inputs[x] ?? 0) || (a.inputs[y] ?? 0) - (b.inputs[y] ?? 0));
	}
	function sortArtMeshMultiBindings(bindings) {
		for (const binding of bindings ?? []) {
			const [x, y] = binding.parameters;
			binding.keyforms.sort((a, b) => (a.inputs[x] ?? 0) - (b.inputs[x] ?? 0) || (a.inputs[y] ?? 0) - (b.inputs[y] ?? 0));
		}
	}
	function sortWarpPins(pins) {
		for (const pin of pins ?? []) {
			for (const binding of pin.bindings ?? []) binding.keys.sort((a, b) => a.input - b.input);
			for (const binding of pin.multiBindings ?? []) {
				const [x, y] = binding.parameters;
				binding.keyforms.sort((a, b) => (a.inputs[x] ?? 0) - (b.inputs[x] ?? 0) || (a.inputs[y] ?? 0) - (b.inputs[y] ?? 0));
			}
		}
	}
	function sortedKeysOrCopy(keys) {
		for (let i = 1; i < keys.length; i++) if (keys[i - 1].input > keys[i].input) return [...keys].sort((a, b) => a.input - b.input);
		return keys;
	}
	function orderedAxis(values) {
		const axis = [...values];
		for (let i = 1; i < axis.length; i++) if (axis[i - 1] > axis[i]) return axis.sort((a, b) => a - b);
		return axis;
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/bindings.ts
	var INTERPOLATION_SET = new Set(PARAMETER_INTERPOLATIONS);
	function isParameterInterpolation(value) {
		return typeof value === "string" && INTERPOLATION_SET.has(value);
	}
	function normalizeParameterInterpolation(value) {
		return isParameterInterpolation(value) ? value : "linear";
	}
	function sampleBinding(binding, input) {
		const keys = sortedKeysOrCopy(binding.keys);
		if (keys.length === 0) return 0;
		if (input <= keys[0].input) return keys[0].value;
		const last = keys[keys.length - 1];
		if (input >= last.input) return last.value;
		for (let index = 0; index < keys.length - 1; index += 1) {
			const from = keys[index];
			const to = keys[index + 1];
			if (input >= from.input && input <= to.input) {
				const amount = (input - from.input) / (to.input - from.input || 1);
				const eased = applyParameterInterpolation(normalizeParameterInterpolation(binding.interpolation), amount, binding.curve);
				return from.value + (to.value - from.value) * eased;
			}
		}
		return 0;
	}
	function applyParameterInterpolation(interpolation, amount, curve) {
		const clamped = Math.min(1, Math.max(0, amount));
		if (interpolation === "smoothstep") return clamped * clamped * (3 - 2 * clamped);
		if (interpolation === "hold") return clamped >= 1 ? 1 : 0;
		if (interpolation === "arc") return Math.sin(clamped * Math.PI / 2);
		if (interpolation === "curve") return sampleParameterCurve(curve, clamped);
		return clamped;
	}
	function sampleParameterCurve(curve, amount) {
		const clamped = Math.min(1, Math.max(0, amount));
		const points = (curve?.controlPoints ?? []).filter((point) => Number.isFinite(point?.t) && Number.isFinite(point?.value)).map((point) => ({
			t: Math.min(1, Math.max(0, point.t)),
			value: Math.min(1, Math.max(0, point.value))
		})).sort((left, right) => left.t - right.t);
		if (points.length < 2) return clamped;
		if (clamped <= points[0].t) return points[0].value;
		const lastIndex = points.length - 1;
		if (clamped >= points[lastIndex].t) return points[lastIndex].value;
		for (let index = 0; index < lastIndex; index += 1) {
			const from = points[index];
			const to = points[index + 1];
			if (clamped < from.t || clamped > to.t) continue;
			const span = to.t - from.t || 1;
			const u = (clamped - from.t) / span;
			const p0 = points[Math.max(0, index - 1)].value;
			const p1 = from.value;
			const p2 = to.value;
			const p3 = points[Math.min(lastIndex, index + 2)].value;
			const u2 = u * u;
			const u3 = u2 * u;
			const value = .5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
			return Math.min(1, Math.max(0, value));
		}
		return clamped;
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/artMeshBlendShape.ts
	/** Sample a neutral-to-delta ArtMesh shape without changing the neutral mesh. */
	function sampleArtMeshBlendShape(shape, input) {
		if (!Number.isFinite(input) || !Number.isFinite(shape.neutralInput) || !Number.isFinite(shape.targetInput) || shape.neutralInput === shape.targetInput) return /* @__PURE__ */ new Map();
		const weight = sampleArtMeshBlendShapeWeight(shape, input);
		const offsets = /* @__PURE__ */ new Map();
		for (const offset of shape.offsets ?? []) if (offset && typeof offset.vertexId === "string" && Number.isFinite(offset.x) && Number.isFinite(offset.y)) offsets.set(offset.vertexId, {
			x: offset.x * weight,
			y: offset.y * weight
		});
		return offsets;
	}
	function sampleArtMeshBlendShapeWeight(shape, input) {
		if (!Number.isFinite(input) || !Number.isFinite(shape.neutralInput) || !Number.isFinite(shape.targetInput) || shape.neutralInput === shape.targetInput) return 0;
		const amount = Math.min(1, Math.max(0, (input - shape.neutralInput) / (shape.targetInput - shape.neutralInput)));
		return applyParameterInterpolation(normalizeParameterInterpolation(shape.interpolation), amount, shape.curve);
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/extendedBlendShape.ts
	var blendWeight = (shape, values) => sampleArtMeshBlendShapeWeight(shape, values[shape.parameter] ?? shape.neutralInput);
	function applyTransformShapes(pose, shapes, values) {
		for (const shape of shapes ?? []) {
			const w = blendWeight(shape, values);
			for (const [key, value] of Object.entries(shape.transform ?? {})) {
				const property = key;
				if (property === "scaleX" || property === "scaleY") pose[property] *= Math.pow(value, w);
				else pose[property] += value * w;
			}
		}
	}
	function resolveSharedShape(field, shapes, values) {
		if (!field || !shapes?.some((s) => s.sharedPoints?.length) && !field.controlPoints.some((p) => p.bindings?.length)) return field;
		const result = structuredClone(field);
		for (const point of result.controlPoints) for (const binding of (point.bindings ?? []).slice(0, 16)) {
			const value = sampleBinding(binding, values[binding.parameter] ?? 0);
			point[binding.property] = binding.additive === false ? value : point[binding.property] + value;
		}
		for (const shape of shapes ?? []) for (const delta of shape.sharedPoints ?? []) {
			const point = result.controlPoints.find((p) => p.id === delta.id);
			if (point) {
				const w = blendWeight(shape, values);
				point.offsetX += delta.x * w;
				point.offsetY += delta.y * w;
			}
		}
		return result;
	}
	function glueBlendStrength(glue, values = {}) {
		const base = glue.mode === "stitch" ? 1 : glue.strength;
		return Math.min(1, Math.max(0, base + (glue.blendShapes ?? []).reduce((sum, s) => sum + s.strength * blendWeight(s, values), 0)));
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/multiBindings.ts
	function sampleMultiParameterBinding(binding, values) {
		if (!Array.isArray(binding.parameters) || binding.parameters.length !== 2) return void 0;
		const [xParameter, yParameter] = binding.parameters;
		if (!xParameter || !yParameter || xParameter === yParameter) return void 0;
		const points = /* @__PURE__ */ new Map();
		const xs = /* @__PURE__ */ new Set();
		const ys = /* @__PURE__ */ new Set();
		for (const keyform of binding.keyforms ?? []) {
			const x = keyform?.inputs?.[xParameter];
			const y = keyform?.inputs?.[yParameter];
			if (!finite$4(x) || !finite$4(y) || !finite$4(keyform.value)) continue;
			xs.add(x);
			ys.add(y);
			points.set(pointKey(x, y), keyform.value);
		}
		if (xs.size < 2 || ys.size < 2) return void 0;
		const xAxis = orderedAxis(xs);
		const yAxis = orderedAxis(ys);
		const xSpan = enclosingSpan(xAxis, values[xParameter] ?? 0);
		const ySpan = enclosingSpan(yAxis, values[yParameter] ?? 0);
		if (!xSpan || !ySpan) return void 0;
		const q00 = points.get(pointKey(xSpan.low, ySpan.low));
		const q10 = points.get(pointKey(xSpan.high, ySpan.low));
		const q01 = points.get(pointKey(xSpan.low, ySpan.high));
		const q11 = points.get(pointKey(xSpan.high, ySpan.high));
		if (![
			q00,
			q10,
			q01,
			q11
		].every(finite$4)) return void 0;
		const interpolation = normalizeParameterInterpolation(binding.interpolation);
		const tx = applyParameterInterpolation(interpolation, ratio$1(values[xParameter] ?? 0, xSpan.low, xSpan.high), binding.curve);
		const ty = applyParameterInterpolation(interpolation, ratio$1(values[yParameter] ?? 0, ySpan.low, ySpan.high), binding.curve);
		const bottom = q00 + (q10 - q00) * tx;
		return bottom + (q01 + (q11 - q01) * tx - bottom) * ty;
	}
	function enclosingSpan(axis, input) {
		if (axis.length < 2) return void 0;
		const clamped = Math.min(axis[axis.length - 1], Math.max(axis[0], input));
		for (let index = 0; index < axis.length - 1; index += 1) if (clamped >= axis[index] && clamped <= axis[index + 1]) return {
			low: axis[index],
			high: axis[index + 1]
		};
		return {
			low: axis[axis.length - 2],
			high: axis[axis.length - 1]
		};
	}
	function ratio$1(value, low, high) {
		return Math.min(1, Math.max(0, (value - low) / (high - low || 1)));
	}
	function pointKey(x, y) {
		return `${x}\u0000${y}`;
	}
	function finite$4(value) {
		return typeof value === "number" && Number.isFinite(value);
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/warp.ts
	var resolvedPinScopes = /* @__PURE__ */ new WeakMap();
	function defaultWarpDeformer() {
		return {
			enabled: true,
			bendX: 0,
			bendY: 0,
			taperX: 0,
			taperY: 0,
			grid: {
				columns: 4,
				rows: 4
			},
			pins: []
		};
	}
	function normalizeWarpDeformer(warp) {
		const fallback = defaultWarpDeformer();
		const grid = warp?.grid;
		return {
			enabled: warp?.enabled !== false,
			pinBlendMode: warp?.pinBlendMode === "normalized" ? "normalized" : "legacy",
			bendX: finiteNumber$1(warp?.bendX, fallback.bendX),
			bendY: finiteNumber$1(warp?.bendY, fallback.bendY),
			taperX: finiteNumber$1(warp?.taperX, fallback.taperX),
			taperY: finiteNumber$1(warp?.taperY, fallback.taperY),
			grid: {
				columns: clampInteger(finiteNumber$1(grid?.columns, fallback.grid.columns), 1, 16),
				rows: clampInteger(finiteNumber$1(grid?.rows, fallback.grid.rows), 1, 16)
			},
			pins: Array.isArray(warp?.pins) ? warp.pins.slice(0, 32).map((pin, index) => normalizeWarpPin(pin, index)) : []
		};
	}
	function normalizeWarpPin(pin, index = 0) {
		return {
			id: typeof pin?.id === "string" && pin.id.trim() ? pin.id : `pin-${index + 1}`,
			name: typeof pin?.name === "string" && pin.name.trim() ? pin.name : `Pin ${index + 1}`,
			enabled: pin?.enabled !== false,
			multiBindings: Array.isArray(pin?.multiBindings) ? structuredClone(pin.multiBindings) : [],
			u: clamp01$3(finiteNumber$1(pin?.u, .5)),
			v: clamp01$3(finiteNumber$1(pin?.v, .5)),
			offsetX: finiteNumber$1(pin?.offsetX, 0),
			offsetY: finiteNumber$1(pin?.offsetY, 0),
			radius: clamp$3(finiteNumber$1(pin?.radius, .28), .001, 1.5),
			strength: clamp$3(finiteNumber$1(pin?.strength, .75), 0, 1),
			linkedMirrorId: typeof pin?.linkedMirrorId === "string" && pin.linkedMirrorId.trim() ? pin.linkedMirrorId : void 0,
			bindings: Array.isArray(pin?.bindings) ? pin.bindings.slice(0, 16).map((binding) => normalizeWarpPinBinding(binding)) : []
		};
	}
	function normalizeWarpPinBinding(binding) {
		const property = isWarpPinBindingProperty(binding?.property) ? binding.property : "offsetX";
		const keys = Array.isArray(binding?.keys) ? binding.keys.map((key) => ({
			input: finiteNumber$1(key?.input, 0),
			value: finiteNumber$1(key?.value, 0)
		})).sort((left, right) => left.input - right.input) : [];
		return {
			parameter: typeof binding?.parameter === "string" && binding.parameter.trim() ? binding.parameter : PARAMETER_IDS[0],
			property,
			keys: keys.length ? keys : [{
				input: 0,
				value: 0
			}],
			additive: binding?.additive !== false,
			interpolation: normalizeParameterInterpolation(binding?.interpolation),
			curve: binding?.curve ? structuredClone(binding.curve) : void 0
		};
	}
	function isTransformBindingProperty(property) {
		return TRANSFORM_PROPERTIES.includes(property);
	}
	function isWarpBindingProperty(property) {
		return WARP_BINDING_PROPERTIES.includes(property);
	}
	function isWarpPinBindingProperty(property) {
		return typeof property === "string" && WARP_PIN_BINDING_PROPERTIES.includes(property);
	}
	function getWarpBindingProperty(warp, property) {
		if (property === "warp.bendX") return warp.bendX;
		if (property === "warp.bendY") return warp.bendY;
		if (property === "warp.taperX") return warp.taperX;
		return warp.taperY;
	}
	function setWarpBindingProperty(warp, property, value) {
		if (property === "warp.bendX") warp.bendX = value;
		else if (property === "warp.bendY") warp.bendY = value;
		else if (property === "warp.taperX") warp.taperX = value;
		else warp.taperY = value;
	}
	function hasWarpEffect(warp) {
		return !!warp && warp.enabled && (Math.abs(warp.bendX) > .001 || Math.abs(warp.bendY) > .001 || Math.abs(warp.taperX) > .001 || Math.abs(warp.taperY) > .001 || (warp.pins ?? []).some((pin) => pin.enabled !== false && pin.strength > .001 && (Math.abs(pin.offsetX) > .001 || Math.abs(pin.offsetY) > .001 || hasWarpPinBindingEffect(pin))));
	}
	function resolveDeformerWarp(deformer, values, sampleBinding) {
		if (deformer.kind !== "warp") return;
		const warp = normalizeWarpDeformer(deformer.warp);
		for (const pin of warp.pins ?? []) resolvedPinScopes.set(pin, deformer.id);
		for (const binding of deformer.bindings ?? []) {
			if (!isWarpBindingProperty(binding.property)) continue;
			const sampled = sampleBinding(binding, values[binding.parameter] ?? 0);
			if (binding.additive === false) setWarpBindingProperty(warp, binding.property, sampled);
			else setWarpBindingProperty(warp, binding.property, getWarpBindingProperty(warp, binding.property) + sampled);
		}
		for (const binding of deformer.multiBindings ?? []) {
			if (!isWarpBindingProperty(binding.property)) continue;
			const sampled = sampleMultiParameterBinding(binding, values);
			if (sampled === void 0) continue;
			if (binding.additive === false) setWarpBindingProperty(warp, binding.property, sampled);
			else setWarpBindingProperty(warp, binding.property, getWarpBindingProperty(warp, binding.property) + sampled);
		}
		for (const pin of warp.pins ?? []) {
			for (const binding of pin.bindings ?? []) {
				const sampled = sampleBinding(binding, values[binding.parameter] ?? 0);
				const current = binding.property === "offsetX" ? pin.offsetX : pin.offsetY;
				const value = binding.additive === false ? sampled : current + sampled;
				if (binding.property === "offsetX") pin.offsetX = value;
				else pin.offsetY = value;
			}
			for (const binding of pin.multiBindings ?? []) {
				const sampled = sampleMultiParameterBinding(binding, values);
				if (sampled === void 0) continue;
				const current = binding.property === "offsetX" ? pin.offsetX : pin.offsetY;
				const value = binding.additive === false ? sampled : current + sampled;
				if (binding.property === "offsetX") pin.offsetX = value;
				else pin.offsetY = value;
			}
		}
		for (const shape of deformer.blendShapes ?? []) {
			const w = blendWeight(shape, values);
			for (const key of [
				"bendX",
				"bendY",
				"taperX",
				"taperY"
			]) warp[key] += (shape.warp?.[key] ?? 0) * w;
			for (const delta of shape.pins ?? []) {
				const pin = warp.pins?.find((p) => p.id === delta.id);
				if (pin) {
					pin.offsetX += delta.x * w;
					pin.offsetY += delta.y * w;
				}
			}
		}
		return warp.enabled ? warp : void 0;
	}
	function mergeResolvedWarpDeformers(parentWarp, childWarp) {
		if (!parentWarp) return childWarp ? cloneResolvedWarp(childWarp) : void 0;
		if (!childWarp) return cloneResolvedWarp(parentWarp);
		const parent = cloneResolvedWarp(parentWarp);
		const child = cloneResolvedWarp(childWarp);
		const pins = [];
		const pinsById = /* @__PURE__ */ new Map();
		const addPin = (pin) => {
			const next = cloneWarpPin(pin);
			if (next.enabled === false) {
				next.offsetX = 0;
				next.offsetY = 0;
			}
			const scope = resolvedPinScopes.get(next);
			const key = scope ? `${scope}\u0000${next.id}` : next.id;
			const existing = pinsById.get(key);
			if (!existing) {
				pins.push(next);
				pinsById.set(key, next);
				return;
			}
			existing.enabled = existing.enabled !== false || next.enabled !== false;
			if (next.enabled !== false) {
				existing.offsetX += next.offsetX;
				existing.offsetY += next.offsetY;
			}
			existing.radius = Math.max(existing.radius, next.radius);
			existing.strength = Math.max(existing.strength, next.strength);
			existing.name = next.name || existing.name;
			existing.bindings = [...existing.bindings ?? [], ...next.bindings ?? []];
		};
		for (const pin of parent.pins ?? []) addPin(pin);
		for (const pin of child.pins ?? []) addPin(pin);
		return {
			enabled: parent.enabled !== false || child.enabled !== false,
			pinBlendMode: child.pinBlendMode === "normalized" ? "normalized" : parent.pinBlendMode,
			bendX: parent.bendX + child.bendX,
			bendY: parent.bendY + child.bendY,
			taperX: parent.taperX + child.taperX,
			taperY: parent.taperY + child.taperY,
			grid: {
				columns: Math.max(parent.grid.columns, child.grid.columns),
				rows: Math.max(parent.grid.rows, child.grid.rows)
			},
			pins
		};
	}
	function cloneResolvedWarp(warp) {
		return {
			enabled: warp.enabled,
			pinBlendMode: warp.pinBlendMode,
			bendX: warp.bendX,
			bendY: warp.bendY,
			taperX: warp.taperX,
			taperY: warp.taperY,
			grid: { ...warp.grid },
			pins: (warp.pins ?? []).map(cloneWarpPin)
		};
	}
	function cloneWarpPin(pin) {
		const clone = {
			...pin,
			bindings: (pin.bindings ?? []).map((binding) => ({
				...binding,
				keys: binding.keys.map((key) => ({ ...key }))
			}))
		};
		const scope = resolvedPinScopes.get(pin);
		if (scope) resolvedPinScopes.set(clone, scope);
		return clone;
	}
	function warpPoint(x, y, bounds, warp) {
		if (!bounds.width || !bounds.height || !warp.enabled) return {
			x,
			y
		};
		const u = (x - bounds.left) / bounds.width;
		const v = (y - bounds.top) / bounds.height;
		const xNorm = u * 2 - 1;
		const yNorm = v * 2 - 1;
		const bendX = warp.bendX * (1 - yNorm * yNorm);
		const bendY = warp.bendY * (1 - xNorm * xNorm);
		const taperX = warp.taperX * xNorm * yNorm;
		const taperY = warp.taperY * yNorm * xNorm;
		let dx = bendX + taperX;
		let dy = bendY + taperY;
		if (warp.pinBlendMode === "normalized") {
			let total = 0;
			let pinX = 0;
			let pinY = 0;
			for (const pin of warp.pins ?? []) {
				if (pin.enabled === false || pin.strength <= 0) continue;
				const distance = Math.hypot(u - pin.u, v - pin.v) / Math.max(.001, pin.radius);
				if (distance >= 1) continue;
				const influence = smoothstep01(1 - distance) * pin.strength;
				total += influence;
				pinX += pin.offsetX * influence;
				pinY += pin.offsetY * influence;
			}
			if (total > 0) {
				const baseWeight = Math.max(0, 1 - total);
				dx = (dx * baseWeight + pinX) / (baseWeight + total);
				dy = (dy * baseWeight + pinY) / (baseWeight + total);
			}
			return {
				x: x + dx,
				y: y + dy
			};
		}
		for (const pin of warp.pins ?? []) {
			if (pin.enabled === false || pin.strength <= 0) continue;
			const distance = Math.hypot(u - pin.u, v - pin.v) / Math.max(.001, pin.radius);
			if (distance >= 1) continue;
			const influence = smoothstep01(1 - distance) * pin.strength;
			dx += (pin.offsetX - dx) * influence;
			dy += (pin.offsetY - dy) * influence;
		}
		return {
			x: x + dx,
			y: y + dy
		};
	}
	function hasWarpPinBindingEffect(pin) {
		return (pin.bindings ?? []).some((binding) => binding.keys.some((key) => Math.abs(key.value) > .001));
	}
	function finiteNumber$1(value, fallback) {
		return typeof value === "number" && Number.isFinite(value) ? value : fallback;
	}
	function clampInteger(value, min, max) {
		return Math.min(max, Math.max(min, Math.round(value)));
	}
	function clamp01$3(value) {
		return clamp$3(value, 0, 1);
	}
	function clamp$3(value, min, max) {
		return Math.min(max, Math.max(min, value));
	}
	function smoothstep01(value) {
		const t = clamp01$3(value);
		return t * t * (3 - 2 * t);
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/sharedWarp.ts
	/** Compile a snapshot for repeated sampling within one evaluation frame. */
	function createSharedWarpSampler(field) {
		const snapshot = {
			...field,
			bounds: { ...field.bounds },
			grid: { ...field.grid }
		};
		const points = new Map(field.controlPoints.map((point) => [`${point.column}|${point.row}`, { ...point }]));
		return (x, y) => sampleIndexedSharedWarpField(snapshot, points, x, y);
	}
	function sampleSharedWarpField(field, x, y) {
		if (!field.enabled) return {
			x: 0,
			y: 0
		};
		return sampleIndexedSharedWarpField(field, new Map(field.controlPoints.map((point) => [`${point.column}|${point.row}`, point])), x, y);
	}
	function sampleIndexedSharedWarpField(field, points, x, y) {
		if (!field.enabled) return {
			x: 0,
			y: 0
		};
		const u = clamp$2((x - field.bounds.left) / field.bounds.width, 0, 1);
		const v = clamp$2((y - field.bounds.top) / field.bounds.height, 0, 1);
		const gx = u * field.grid.columns;
		const gy = v * field.grid.rows;
		const x0 = Math.floor(gx), y0 = Math.floor(gy);
		const x1 = Math.min(field.grid.columns, x0 + 1), y1 = Math.min(field.grid.rows, y0 + 1);
		const tx = gx - x0, ty = gy - y0;
		const point = (column, row) => points.get(`${column}|${row}`);
		const offset = (column, row) => {
			const entry = point(column, row);
			return entry && entry.enabled !== false ? entry : {
				offsetX: 0,
				offsetY: 0
			};
		};
		const q00 = offset(x0, y0), q10 = offset(x1, y0), q01 = offset(x0, y1), q11 = offset(x1, y1);
		return {
			x: bilinear$1(q00.offsetX, q10.offsetX, q01.offsetX, q11.offsetX, tx, ty),
			y: bilinear$1(q00.offsetY, q10.offsetY, q01.offsetY, q11.offsetY, tx, ty)
		};
	}
	function warpSharedFieldPoint(field, x, y) {
		const offset = sampleSharedWarpField(field, x, y);
		return {
			x: x + offset.x,
			y: y + offset.y
		};
	}
	function hasSharedWarpFieldEffect(field) {
		return Boolean(field?.enabled && field.controlPoints.some((point) => point.enabled !== false && (Math.abs(point.offsetX) > 1e-4 || Math.abs(point.offsetY) > 1e-4)));
	}
	function bilinear$1(q00, q10, q01, q11, tx, ty) {
		return q00 * (1 - tx) * (1 - ty) + q10 * tx * (1 - ty) + q01 * (1 - tx) * ty + q11 * tx * ty;
	}
	function clamp$2(value, min, max) {
		return Math.min(max, Math.max(min, value));
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/deformers.ts
	function deformerForPart(part, deformers) {
		if (part.deformerId) return deformers.find((deformer) => deformer.id === part.deformerId);
		return deformers.find((deformer) => deformer.targetPartIds?.includes(part.id));
	}
	var DEFAULT_PARAMETERS = [
		{
			id: "ParamAngleX",
			label: "Angle X",
			min: -30,
			max: 30,
			default: 0,
			step: 1,
			group: "Face"
		},
		{
			id: "ParamAngleY",
			label: "Angle Y",
			min: -30,
			max: 30,
			default: 0,
			step: 1,
			group: "Face"
		},
		{
			id: "ParamAngleZ",
			label: "Angle Z",
			min: -30,
			max: 30,
			default: 0,
			step: 1,
			group: "Face"
		},
		{
			id: "ParamEyeBallX",
			label: "Eye Ball X",
			min: -1,
			max: 1,
			default: 0,
			step: .01,
			group: "Gaze"
		},
		{
			id: "ParamEyeBallY",
			label: "Eye Ball Y",
			min: -1,
			max: 1,
			default: 0,
			step: .01,
			group: "Gaze"
		},
		{
			id: "ParamBodyAngleX",
			label: "Body X",
			min: -30,
			max: 30,
			default: 0,
			step: 1,
			group: "Body"
		},
		{
			id: "ParamBodyAngleY",
			label: "Body Y",
			min: -30,
			max: 30,
			default: 0,
			step: 1,
			group: "Body"
		},
		{
			id: "ParamMouthOpen",
			label: "Mouth",
			min: 0,
			max: 1,
			default: 0,
			step: .01,
			group: "Expression"
		},
		{
			id: "ParamMouthForm",
			label: "Mouth Form",
			min: -1,
			max: 1,
			default: 0,
			step: .01,
			group: "Expression"
		},
		{
			id: "ParamMouthSmile",
			label: "Mouth Smile",
			min: -1,
			max: 1,
			default: 0,
			step: .01,
			group: "Expression"
		},
		{
			id: "ParamEyeLOpen",
			label: "Eye L",
			min: 0,
			max: 1,
			default: 1,
			step: .01,
			group: "Expression"
		},
		{
			id: "ParamEyeROpen",
			label: "Eye R",
			min: 0,
			max: 1,
			default: 1,
			step: .01,
			group: "Expression"
		},
		...[
			{
				id: "ParamBodyAngleZ",
				label: "Body Z",
				min: -10,
				max: 10,
				default: 0,
				step: .1,
				group: "Body"
			},
			{
				id: "ParamBreath",
				label: "Breath",
				min: 0,
				max: 1,
				default: 0,
				step: .01,
				group: "Body"
			},
			{
				id: "ParamCheek",
				label: "Cheek",
				min: 0,
				max: 1,
				default: 0,
				step: .01,
				group: "Expression"
			},
			{
				id: "ParamEyeLSmile",
				label: "Eye L Smile",
				min: 0,
				max: 1,
				default: 0,
				step: .01,
				group: "Expression"
			},
			{
				id: "ParamEyeRSmile",
				label: "Eye R Smile",
				min: 0,
				max: 1,
				default: 0,
				step: .01,
				group: "Expression"
			},
			{
				id: "ParamBrowLY",
				label: "Brow L Y",
				min: -1,
				max: 1,
				default: 0,
				step: .01,
				group: "Brow"
			},
			{
				id: "ParamBrowRY",
				label: "Brow R Y",
				min: -1,
				max: 1,
				default: 0,
				step: .01,
				group: "Brow"
			},
			{
				id: "ParamBrowLX",
				label: "Brow L X",
				min: -1,
				max: 1,
				default: 0,
				step: .01,
				group: "Brow"
			},
			{
				id: "ParamBrowRX",
				label: "Brow R X",
				min: -1,
				max: 1,
				default: 0,
				step: .01,
				group: "Brow"
			},
			{
				id: "ParamBrowLAngle",
				label: "Brow L Angle",
				min: -1,
				max: 1,
				default: 0,
				step: .01,
				group: "Brow"
			},
			{
				id: "ParamBrowRAngle",
				label: "Brow R Angle",
				min: -1,
				max: 1,
				default: 0,
				step: .01,
				group: "Brow"
			},
			{
				id: "ParamBrowLForm",
				label: "Brow L Form",
				min: -1,
				max: 1,
				default: 0,
				step: .01,
				group: "Brow"
			},
			{
				id: "ParamBrowRForm",
				label: "Brow R Form",
				min: -1,
				max: 1,
				default: 0,
				step: .01,
				group: "Brow"
			},
			{
				id: "ParamHairFront",
				label: "Hair Front",
				min: -1,
				max: 1,
				default: 0,
				step: .01,
				group: "Physics"
			},
			{
				id: "ParamHairSide",
				label: "Hair Side",
				min: -1,
				max: 1,
				default: 0,
				step: .01,
				group: "Physics"
			},
			{
				id: "ParamHairBack",
				label: "Hair Back",
				min: -1,
				max: 1,
				default: 0,
				step: .01,
				group: "Physics"
			},
			{
				id: "ParamSkirt",
				label: "Skirt",
				min: -1,
				max: 1,
				default: 0,
				step: .01,
				group: "Physics"
			},
			{
				id: "ParamRibbon",
				label: "Ribbon",
				min: -1,
				max: 1,
				default: 0,
				step: .01,
				group: "Physics"
			}
		]
	];
	function parameterDefinitionsForRig$1(rig) {
		const merged = /* @__PURE__ */ new Map();
		for (const parameter of DEFAULT_PARAMETERS) merged.set(parameter.id, parameter);
		for (const parameter of rig.parameters ?? []) merged.set(parameter.id, {
			...merged.get(parameter.id),
			...parameter
		});
		return Array.from(merged.values());
	}
	function defaultParameterValues(rig) {
		const values = {};
		for (const parameter of parameterDefinitionsForRig$1(rig)) values[parameter.id] = parameter.default;
		return values;
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/evaluator.ts
	var MIN_SCALE = .001;
	/**
	* Resolve one complete model frame for every renderer.
	*
	* Preview/OBS pass a live `physicsState`, while server screenshots omit it and
	* use deterministic warm-up steps. Both paths still share the same effective
	* parameter and part/deformer evaluation afterwards.
	*/
	function resolveRigFrame(rig, values, baseMatrix, options = {}) {
		const physics = options.physics !== false ? options.physicsState ? resolvePhysicsFrame(rig, values, options.physicsState, clampPhysicsDt(options.physicsDt), finiteOr(options.physicsTime, 0)) : resolveDeterministicPhysicsFrame(rig, values, finiteOr(options.physicsTime, 0), options.physicsSteps ?? 18, clampPhysicsDt(options.physicsDt)) : emptyPhysicsFrame();
		const effectiveValues = applyPhysicsParameterOffsets(values, physics.parameterOffsets);
		return {
			values: effectiveValues,
			physics,
			skinningTransforms: resolveDeformerSkinningTransforms(evaluateDeformers(rig.deformers ?? [], effectiveValues, physics.deformerOffsets), evaluateDeformers(rig.deformers ?? [], defaultParameterValues(rig))),
			parts: evaluateRigParts(rig, effectiveValues, baseMatrix, {
				physicsOffsets: physics.partOffsets,
				physicsDeformerOffsets: physics.deformerOffsets
			})
		};
	}
	/**
	* Build neutral-relative transforms for ArtMesh skinning. Keeping this pure and
	* independent of any renderer makes Canvas/server/WebGL consume the same
	* vertex deformation result. The neutral-relative matrix is identity at the
	* default pose, so rigs without a skinning profile are unaffected.
	*/
	function resolveDeformerSkinningTransforms(current, neutral) {
		const transforms = /* @__PURE__ */ new Map();
		const ids = /* @__PURE__ */ new Set([...current.keys(), ...neutral.keys()]);
		for (const id of ids) {
			const currentState = current.get(id);
			const neutralState = neutral.get(id);
			if (!currentState || !neutralState) continue;
			transforms.set(id, multiplyMatrices(currentState.matrix, invertMatrix(neutralState.matrix)));
		}
		return transforms;
	}
	function emptyPhysicsFrame() {
		return {
			partOffsets: /* @__PURE__ */ new Map(),
			deformerOffsets: /* @__PURE__ */ new Map(),
			parameterOffsets: {}
		};
	}
	function finiteOr(value, fallback) {
		return typeof value === "number" && Number.isFinite(value) ? value : fallback;
	}
	function clampPhysicsDt(value) {
		return Math.min(.1, Math.max(1e-4, finiteOr(value, 1 / 60)));
	}
	function evaluateRigParts(rig, values, baseMatrix, options = {}) {
		const byId = new Map(rig.parts.map((part) => [part.id, part]));
		const deformers = rig.deformers ?? [];
		const deformerStates = evaluateDeformers(deformers, values, options.physicsDeformerOffsets);
		const computed = /* @__PURE__ */ new Map();
		const visiting = /* @__PURE__ */ new Set();
		const computePart = (part) => {
			const existing = computed.get(part.id);
			if (existing) return existing;
			if (visiting.has(part.id)) {
				const fallback = {
					matrix: baseMatrix,
					parentMatrix: baseMatrix,
					opacity: 1,
					visible: part.visible,
					pose: zeroPose(),
					warp: void 0
				};
				computed.set(part.id, fallback);
				return fallback;
			}
			visiting.add(part.id);
			const parent = part.parentId ? byId.get(part.parentId) : void 0;
			const parentComputed = parent ? computePart(parent) : {
				matrix: baseMatrix,
				parentMatrix: baseMatrix,
				opacity: 1,
				visible: true,
				pose: zeroPose(),
				warp: void 0
			};
			const deformer = deformerForPart(part, deformers);
			const deformerComputed = deformer ? deformerStates.get(deformer.id) : void 0;
			const pose = resolvePartPose(part, values, options.physicsOffsets?.get(part.id));
			const localMatrix = multiplyMatrices(multiplyMatrices(translateMatrix(pose.x, pose.y), rotateMatrix(pose.rotation)), scaleMatrix(safeScale(pose.scaleX), safeScale(pose.scaleY)));
			const parentMatrix = deformerComputed ? multiplyMatrices(parentComputed.matrix, deformerComputed.matrix) : parentComputed.matrix;
			const activeWarp = mergeResolvedWarpDeformers(parentComputed.warp, deformerComputed?.warp);
			const result = {
				parameterValues: values,
				matrix: multiplyMatrices(parentMatrix, localMatrix),
				parentMatrix,
				opacity: parentComputed.opacity * (deformerComputed?.opacity ?? 1) * pose.opacity,
				visible: parentComputed.visible && (deformerComputed?.visible ?? true) && part.visible,
				pose,
				warp: activeWarp,
				sharedWarps: mergeSharedWarpFields(parentComputed.sharedWarps, deformerComputed?.sharedWarps)
			};
			computed.set(part.id, result);
			visiting.delete(part.id);
			return result;
		};
		for (const part of rig.parts) computePart(part);
		return computed;
	}
	function evaluateDeformers(deformers, values, physicsOffsets = void 0) {
		const byId = new Map(deformers.map((deformer) => [deformer.id, deformer]));
		const computed = /* @__PURE__ */ new Map();
		const visiting = /* @__PURE__ */ new Set();
		const computeDeformer = (deformer) => {
			const existing = computed.get(deformer.id);
			if (existing) return existing;
			if (visiting.has(deformer.id)) {
				const fallback = {
					matrix: identityMatrix(),
					opacity: 1,
					visible: deformer.visible,
					pose: zeroPose(),
					warp: void 0
				};
				computed.set(deformer.id, fallback);
				return fallback;
			}
			visiting.add(deformer.id);
			const parent = deformer.parentId ? byId.get(deformer.parentId) : void 0;
			const parentComputed = parent ? computeDeformer(parent) : {
				matrix: identityMatrix(),
				opacity: 1,
				visible: true,
				pose: zeroPose(),
				warp: void 0
			};
			const pose = resolveDeformerPose(deformer, values, physicsOffsets?.get(deformer.id));
			const ownWarp = resolveDeformerWarp(deformer, values, sampleBinding);
			const result = {
				matrix: multiplyMatrices(parentComputed.matrix, deformerMatrix(deformer, pose)),
				opacity: parentComputed.opacity * pose.opacity,
				visible: parentComputed.visible && deformer.visible,
				pose,
				warp: mergeResolvedWarpDeformers(parentComputed.warp, ownWarp),
				sharedWarps: mergeSharedWarpFields(parentComputed.sharedWarps, deformer.sharedWarp ? [resolveSharedShape(deformer.sharedWarp, deformer.blendShapes, values)] : void 0)
			};
			computed.set(deformer.id, result);
			visiting.delete(deformer.id);
			return result;
		};
		for (const deformer of deformers) computeDeformer(deformer);
		return computed;
	}
	function mergeSharedWarpFields(parent, own) {
		const fields = [...parent ?? [], ...own ?? []].filter((field) => field.enabled);
		return fields.length ? fields : void 0;
	}
	function resolvePartPose(part, values, physicsOffset) {
		const pose = { ...part.transform };
		for (const binding of part.bindings ?? []) {
			if (!isTransformBindingProperty(binding.property)) continue;
			const sampled = sampleBinding(binding, values[binding.parameter] ?? 0);
			applyTransformBindingSample(pose, binding.property, sampled, binding.additive, binding.composition);
		}
		for (const binding of part.multiBindings ?? []) {
			if (!isTransformBindingProperty(binding.property)) continue;
			const sampled = sampleMultiParameterBinding(binding, values);
			if (sampled === void 0) continue;
			applyTransformBindingSample(pose, binding.property, sampled, binding.additive, binding.composition);
		}
		applyTransformShapes(pose, part.blendShapes, values);
		if (physicsOffset) for (const [property, value] of Object.entries(physicsOffset)) pose[property] += value;
		pose.opacity = Math.min(1, Math.max(0, pose.opacity));
		return pose;
	}
	function resolveDeformerPose(deformer, values, physicsOffset = void 0) {
		const pose = { ...deformer.transform };
		for (const binding of deformer.bindings ?? []) {
			if (!isTransformBindingProperty(binding.property)) continue;
			const sampled = sampleBinding(binding, values[binding.parameter] ?? 0);
			applyTransformBindingSample(pose, binding.property, sampled, binding.additive, binding.composition);
		}
		for (const binding of deformer.multiBindings ?? []) {
			if (!isTransformBindingProperty(binding.property)) continue;
			const sampled = sampleMultiParameterBinding(binding, values);
			if (sampled === void 0) continue;
			applyTransformBindingSample(pose, binding.property, sampled, binding.additive, binding.composition);
		}
		applyTransformShapes(pose, deformer.blendShapes, values);
		if (physicsOffset) for (const [property, value] of Object.entries(physicsOffset)) pose[property] += value;
		pose.opacity = Math.min(1, Math.max(0, pose.opacity));
		return pose;
	}
	function applyTransformBindingSample(pose, property, sampled, additive, composition) {
		if (composition === "multiply" && (property === "scaleX" || property === "scaleY" || property === "opacity")) pose[property] *= sampled;
		else if (additive === false) pose[property] = sampled;
		else pose[property] += sampled;
	}
	function applyPhysicsParameterOffsets(values, offsets) {
		const resolved = { ...values };
		for (const [parameter, offset] of Object.entries(offsets)) resolved[parameter] = (resolved[parameter] ?? 0) + offset;
		return resolved;
	}
	function resolvePhysicsFrame(rig, values, state, dt, timeSeconds) {
		const partOffsets = /* @__PURE__ */ new Map();
		const deformerOffsets = /* @__PURE__ */ new Map();
		const parameterOffsets = {};
		if (!rig.physics?.enabled) return {
			partOffsets,
			deformerOffsets,
			parameterOffsets
		};
		const safeDt = Math.min(.1, Math.max(1e-4, dt));
		for (const chain of rig.physics.chains ?? []) {
			if (!chain.enabled) continue;
			const input = chain.sourceParameters.reduce((total, source) => total + (values[source.parameter] ?? 0) * source.scale, 0);
			const wind = chain.wind ? Math.sin(timeSeconds * 1.8) * chain.wind : 0;
			const target = input + chain.gravity + wind;
			if (chain.parameterOutput) {
				const output = chain.parameterOutput;
				let value = resolveChainPhysicsValue(state, `${chain.id}:parameter:${output.parameter}`, target, chain, safeDt) * output.scale;
				if (Number.isFinite(output.min)) value = Math.max(output.min, value);
				if (Number.isFinite(output.max)) value = Math.min(output.max, value);
				parameterOffsets[output.parameter] = (parameterOffsets[output.parameter] ?? 0) + value;
				continue;
			}
			for (const deformerId of chain.targetDeformerIds ?? []) {
				const physicsValue = resolveChainPhysicsValue(state, `${chain.id}:deformer:${deformerId}`, target, chain, safeDt);
				const deformerOffset = deformerOffsets.get(deformerId) ?? {};
				deformerOffset[chain.output.property] = (deformerOffset[chain.output.property] ?? 0) + physicsValue * chain.output.scale;
				deformerOffsets.set(deformerId, deformerOffset);
			}
			for (const partId of chain.targetPartIds ?? []) {
				const physicsValue = resolveChainPhysicsValue(state, `${chain.id}:${partId}`, target, chain, safeDt);
				const partOffset = partOffsets.get(partId) ?? {};
				partOffset[chain.output.property] = (partOffset[chain.output.property] ?? 0) + physicsValue * chain.output.scale;
				partOffsets.set(partId, partOffset);
			}
		}
		return {
			partOffsets,
			deformerOffsets,
			parameterOffsets
		};
	}
	function resolveChainPhysicsValue(state, baseKey, target, chain, dt) {
		const segments = chain.segments?.filter((segment) => segment && segment.id);
		if (!segments?.length) {
			const physics = advancePhysicsValue(state.get(baseKey), target, chain, dt);
			state.set(baseKey, physics);
			return physics.value;
		}
		const substeps = Math.max(1, Math.min(12, Math.ceil(dt / (1 / 120))));
		const subDt = dt / substeps;
		let finalValue = 0;
		for (let step = 0; step < substeps; step += 1) {
			let driver = target;
			for (const segment of segments.slice(0, 8)) {
				const key = `${baseKey}:segment:${segment.id}`;
				const current = state.get(key) ?? {
					value: 0,
					velocity: 0,
					target: 0
				};
				const delay = clampFinite(segment.delay, 0, 2, .08);
				const alpha = delay <= 0 ? 1 : 1 - Math.exp(-subDt / delay);
				current.target = (current.target ?? driver) + (driver - (current.target ?? driver)) * alpha;
				const stageChain = {
					...chain,
					mass: chain.mass * clampFinite(segment.length, .05, 8, 1),
					damping: chain.damping * clampFinite(segment.damping, 0, 8, 1)
				};
				const physics = advancePhysicsValue(current, current.target, stageChain, subDt);
				state.set(key, physics);
				driver = physics.value;
				finalValue = physics.value;
			}
		}
		return finalValue;
	}
	function clampFinite(value, min, max, fallback) {
		return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
	}
	function advancePhysicsValue(current, target, chain, dt) {
		const physics = current ?? {
			value: 0,
			velocity: 0
		};
		const mass = Math.max(.001, chain.mass);
		const acceleration = ((target - physics.value) * chain.stiffness - physics.velocity * chain.damping) / mass;
		physics.velocity += acceleration * dt;
		physics.value += physics.velocity * dt;
		return physics;
	}
	function resolveDeterministicPhysicsFrame(rig, values, timeSeconds, steps = 18, dt = 1 / 60) {
		const state = /* @__PURE__ */ new Map();
		let frame = {
			partOffsets: /* @__PURE__ */ new Map(),
			deformerOffsets: /* @__PURE__ */ new Map(),
			parameterOffsets: {}
		};
		const safeSteps = Math.max(0, Math.min(240, Math.round(steps)));
		for (let index = 0; index < safeSteps; index += 1) frame = resolvePhysicsFrame(rig, values, state, dt, timeSeconds + index * dt);
		return frame;
	}
	function identityMatrix() {
		return {
			a: 1,
			b: 0,
			c: 0,
			d: 1,
			e: 0,
			f: 0
		};
	}
	function translateMatrix(x, y) {
		return {
			a: 1,
			b: 0,
			c: 0,
			d: 1,
			e: x,
			f: y
		};
	}
	function rotateMatrix(degrees) {
		const radians = degrees * Math.PI / 180;
		const cos = Math.cos(radians);
		const sin = Math.sin(radians);
		return {
			a: cos,
			b: sin,
			c: -sin,
			d: cos,
			e: 0,
			f: 0
		};
	}
	function scaleMatrix(x, y) {
		return {
			a: x,
			b: 0,
			c: 0,
			d: y,
			e: 0,
			f: 0
		};
	}
	function multiplyMatrices(left, right) {
		return {
			a: left.a * right.a + left.c * right.b,
			b: left.b * right.a + left.d * right.b,
			c: left.a * right.c + left.c * right.d,
			d: left.b * right.c + left.d * right.d,
			e: left.a * right.e + left.c * right.f + left.e,
			f: left.b * right.e + left.d * right.f + left.f
		};
	}
	function invertMatrix(matrix) {
		const determinant = matrix.a * matrix.d - matrix.b * matrix.c || 1;
		return {
			a: matrix.d / determinant,
			b: -matrix.b / determinant,
			c: -matrix.c / determinant,
			d: matrix.a / determinant,
			e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
			f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant
		};
	}
	function transformMatrixPoint(matrix, x, y) {
		return {
			x: matrix.a * x + matrix.c * y + matrix.e,
			y: matrix.b * x + matrix.d * y + matrix.f
		};
	}
	function safeScale(value) {
		if (Math.abs(value) >= MIN_SCALE) return value;
		return value < 0 ? -.001 : MIN_SCALE;
	}
	function zeroPose() {
		return {
			x: 0,
			y: 0,
			rotation: 0,
			scaleX: 1,
			scaleY: 1,
			pivotX: .5,
			pivotY: .5,
			opacity: 1
		};
	}
	function deformerMatrix(deformer, pose) {
		return multiplyMatrices(multiplyMatrices(multiplyMatrices(translateMatrix(deformer.origin.x, deformer.origin.y), multiplyMatrices(translateMatrix(pose.x, pose.y), rotateMatrix(pose.rotation))), scaleMatrix(safeScale(pose.scaleX), safeScale(pose.scaleY))), translateMatrix(-deformer.origin.x, -deformer.origin.y));
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/artMeshMulti.ts
	function sampleMultiArtMeshBinding(binding, values) {
		const [xParameter, yParameter] = binding.parameters ?? [];
		if (!xParameter || !yParameter || xParameter === yParameter) return /* @__PURE__ */ new Map();
		const points = /* @__PURE__ */ new Map();
		const xs = /* @__PURE__ */ new Set();
		const ys = /* @__PURE__ */ new Set();
		for (const keyform of binding.keyforms ?? []) {
			const x = keyform?.inputs?.[xParameter];
			const y = keyform?.inputs?.[yParameter];
			if (!finite$3(x) || !finite$3(y)) continue;
			xs.add(x);
			ys.add(y);
			points.set(key(x, y), keyform);
		}
		const xSpan = span(orderedAxis(xs), values[xParameter] ?? 0);
		const ySpan = span(orderedAxis(ys), values[yParameter] ?? 0);
		if (!xSpan || !ySpan) return /* @__PURE__ */ new Map();
		const corners = [
			points.get(key(xSpan.low, ySpan.low)),
			points.get(key(xSpan.high, ySpan.low)),
			points.get(key(xSpan.low, ySpan.high)),
			points.get(key(xSpan.high, ySpan.high))
		];
		if (corners.some((corner) => !corner)) return /* @__PURE__ */ new Map();
		const tx = applyParameterInterpolation(normalizeParameterInterpolation(binding.interpolation), ratio(values[xParameter] ?? 0, xSpan.low, xSpan.high), binding.curve);
		const ty = applyParameterInterpolation(normalizeParameterInterpolation(binding.interpolation), ratio(values[yParameter] ?? 0, ySpan.low, ySpan.high), binding.curve);
		const offsets = corners.map((corner) => offsetsForKey(corner));
		const ids = new Set(offsets.flatMap((entry) => [...entry.keys()]));
		const result = /* @__PURE__ */ new Map();
		for (const id of ids) {
			const q00 = offsets[0].get(id) ?? {
				x: 0,
				y: 0
			};
			const q10 = offsets[1].get(id) ?? {
				x: 0,
				y: 0
			};
			const q01 = offsets[2].get(id) ?? {
				x: 0,
				y: 0
			};
			const q11 = offsets[3].get(id) ?? {
				x: 0,
				y: 0
			};
			result.set(id, {
				x: bilinear(q00.x, q10.x, q01.x, q11.x, tx, ty),
				y: bilinear(q00.y, q10.y, q01.y, q11.y, tx, ty)
			});
		}
		return result;
	}
	function offsetsForKey(keyform) {
		const result = /* @__PURE__ */ new Map();
		for (const offset of keyform.offsets ?? []) if (offset && typeof offset.vertexId === "string" && finite$3(offset.x) && finite$3(offset.y)) result.set(offset.vertexId, {
			x: offset.x,
			y: offset.y
		});
		return result;
	}
	function span(axis, value) {
		if (axis.length < 2) return void 0;
		const input = Math.min(axis[axis.length - 1], Math.max(axis[0], value));
		for (let index = 0; index < axis.length - 1; index += 1) if (input >= axis[index] && input <= axis[index + 1]) return {
			low: axis[index],
			high: axis[index + 1]
		};
	}
	function ratio(value, low, high) {
		return Math.min(1, Math.max(0, (value - low) / (high - low || 1)));
	}
	function bilinear(q00, q10, q01, q11, tx, ty) {
		return q00 * (1 - tx) * (1 - ty) + q10 * tx * (1 - ty) + q01 * (1 - tx) * ty + q11 * tx * ty;
	}
	function key(x, y) {
		return `${x}|${y}`;
	}
	function finite$3(value) {
		return typeof value === "number" && Number.isFinite(value);
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/artMesh.ts
	function isValidArtMesh(mesh, width, height) {
		if (!mesh || mesh.version !== 1 || typeof mesh.enabled !== "boolean" || !Array.isArray(mesh.vertices) || mesh.vertices.length < 3 || !Array.isArray(mesh.triangles) || mesh.triangles.length < 3 || mesh.triangles.length % 3 !== 0) return false;
		if (!mesh.generator || ![
			"eyelid",
			"eye",
			"mouth",
			"outline",
			"hair-root",
			"face-feature"
		].includes(mesh.generator.preset) || !Number.isInteger(mesh.generator.columns) || !Number.isInteger(mesh.generator.rows) || mesh.generator.columns < 1 || mesh.generator.columns > 16 || mesh.generator.rows < 1 || mesh.generator.rows > 16 || !Number.isInteger(mesh.generator.alphaThreshold) || mesh.generator.alphaThreshold < 1 || mesh.generator.alphaThreshold > 255 || !finite$2(mesh.generator.alphaBounds?.left) || !finite$2(mesh.generator.alphaBounds?.top) || !finite$2(mesh.generator.alphaBounds?.width) || !finite$2(mesh.generator.alphaBounds?.height) || mesh.generator.alphaBounds.width <= 0 || mesh.generator.alphaBounds.height <= 0) return false;
		const ids = /* @__PURE__ */ new Set();
		for (const vertex of mesh.vertices) {
			if (!vertex || !vertex.id || ids.has(vertex.id) || !finite$2(vertex.x) || !finite$2(vertex.y) || !finite$2(vertex.u) || !finite$2(vertex.v) || vertex.u < 0 || vertex.u > 1 || vertex.v < 0 || vertex.v > 1) return false;
			ids.add(vertex.id);
		}
		for (let index = 0; index < mesh.triangles.length; index += 3) {
			const a = mesh.triangles[index];
			const b = mesh.triangles[index + 1];
			const c = mesh.triangles[index + 2];
			if (![
				a,
				b,
				c
			].every((value) => Number.isInteger(value) && value >= 0 && value < mesh.vertices.length) || a === b || b === c || a === c) return false;
			const area = triangleArea(mesh.vertices[a], mesh.vertices[b], mesh.vertices[c]);
			if (Math.abs(area) < 1e-4) return false;
		}
		for (const binding of mesh.bindings ?? []) {
			if (!binding || typeof binding.parameter !== "string" || !binding.parameter.trim() || !Array.isArray(binding.keys)) return false;
			for (const key of binding.keys) {
				if (!key || !finite$2(key.input) || !Array.isArray(key.offsets)) return false;
				for (const offset of key.offsets) if (!offset || !ids.has(offset.vertexId) || !finite$2(offset.x) || !finite$2(offset.y)) return false;
			}
		}
		for (const binding of mesh.multiBindings ?? []) {
			if (!binding || !Array.isArray(binding.parameters) || binding.parameters.length !== 2 || !binding.parameters[0]?.trim() || !binding.parameters[1]?.trim() || binding.parameters[0] === binding.parameters[1] || !Array.isArray(binding.keyforms)) return false;
			for (const keyform of binding.keyforms) {
				if (!keyform || !keyform.inputs || !finite$2(keyform.inputs[binding.parameters[0]]) || !finite$2(keyform.inputs[binding.parameters[1]]) || !Array.isArray(keyform.offsets)) return false;
				for (const offset of keyform.offsets) if (!offset || !ids.has(offset.vertexId) || !finite$2(offset.x) || !finite$2(offset.y)) return false;
			}
		}
		for (const shape of mesh.blendShapes ?? []) {
			if (!shape || typeof shape.id !== "string" || !shape.id.trim() || typeof shape.parameter !== "string" || !shape.parameter.trim() || !finite$2(shape.neutralInput) || !finite$2(shape.targetInput) || shape.neutralInput === shape.targetInput || !Array.isArray(shape.offsets)) return false;
			for (const offset of shape.offsets) if (!offset || !ids.has(offset.vertexId) || !finite$2(offset.x) || !finite$2(offset.y)) return false;
		}
		if (mesh.skinning !== void 0) {
			if (mesh.skinning.version !== 1 || !Array.isArray(mesh.skinning.joints) || mesh.skinning.joints.length !== 3 || new Set(mesh.skinning.joints.map((joint) => joint.deformerId)).size !== 3 || !mesh.skinning.vertexWeights || typeof mesh.skinning.vertexWeights !== "object") return false;
			for (const vertex of mesh.vertices) {
				const weights = mesh.skinning.vertexWeights[vertex.id];
				if (!Array.isArray(weights) || !weights.length || weights.length > 3 || weights.some((entry) => !entry || typeof entry.deformerId !== "string" || !finite$2(entry.weight) || entry.weight < 0)) return false;
			}
		}
		if (width !== void 0 && height !== void 0 && (!finite$2(width) || !finite$2(height) || width <= 0 || height <= 0)) return false;
		return true;
	}
	function applyOffsets(target, sampled, additive) {
		for (const [vertexId, offset] of sampled) {
			const current = target.get(vertexId) ?? {
				x: 0,
				y: 0
			};
			target.set(vertexId, additive === false ? offset : {
				x: current.x + offset.x,
				y: current.y + offset.y
			});
		}
	}
	function triangleArea(a, b, c) {
		return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
	}
	function finite$2(value) {
		return typeof value === "number" && Number.isFinite(value);
	}
	function prepareNativeArtMeshResolver(part, width, height) {
		const mesh = part.artMesh;
		if (!mesh?.enabled || !isValidArtMesh(mesh, width, height)) return (_values) => void 0;
		const keyOffsets = /* @__PURE__ */ new WeakMap();
		function buildKeyOffsets(key) {
			const offsets = /* @__PURE__ */ new Map();
			for (const offset of key.offsets ?? []) if (offset && typeof offset.vertexId === "string" && finite$2(offset.x) && finite$2(offset.y)) offsets.set(offset.vertexId, {
				x: offset.x,
				y: offset.y
			});
			return offsets;
		}
		function offsetsForKey(key) {
			let result = keyOffsets.get(key);
			if (!result) {
				result = buildKeyOffsets(key);
				keyOffsets.set(key, result);
			}
			return result;
		}
		function sampleArtMeshBinding(binding, input) {
			const keys = sortedKeysOrCopy(binding.keys);
			if (!keys.length) return /* @__PURE__ */ new Map();
			if (input <= keys[0].input) return offsetsForKey(keys[0]);
			const last = keys[keys.length - 1];
			if (input >= last.input) return offsetsForKey(last);
			for (let index = 0; index < keys.length - 1; index += 1) {
				const from = keys[index];
				const to = keys[index + 1];
				if (input < from.input || input > to.input) continue;
				const amount = applyParameterInterpolation(normalizeParameterInterpolation(binding.interpolation), (input - from.input) / (to.input - from.input || 1), binding.curve);
				const fromOffsets = offsetsForKey(from);
				const toOffsets = offsetsForKey(to);
				const ids = /* @__PURE__ */ new Set([...fromOffsets.keys(), ...toOffsets.keys()]);
				const result = /* @__PURE__ */ new Map();
				for (const id of ids) {
					const start = fromOffsets.get(id) ?? {
						x: 0,
						y: 0
					};
					const end = toOffsets.get(id) ?? {
						x: 0,
						y: 0
					};
					result.set(id, {
						x: start.x + (end.x - start.x) * amount,
						y: start.y + (end.y - start.y) * amount
					});
				}
				return result;
			}
			return /* @__PURE__ */ new Map();
		}
		return (values) => {
			const offsets = /* @__PURE__ */ new Map();
			for (const binding of mesh.bindings ?? []) applyOffsets(offsets, sampleArtMeshBinding(binding, values[binding.parameter] ?? 0), binding.additive);
			for (const binding of mesh.multiBindings ?? []) applyOffsets(offsets, sampleMultiArtMeshBinding(binding, values), binding.additive);
			for (const shape of mesh.blendShapes ?? []) applyOffsets(offsets, sampleArtMeshBlendShape(shape, values[shape.parameter] ?? shape.neutralInput), shape.additive);
			return {
				vertices: mesh.vertices.map((vertex) => {
					const offset = offsets.get(vertex.id) ?? {
						x: 0,
						y: 0
					};
					return {
						...vertex,
						x: vertex.x + offset.x,
						y: vertex.y + offset.y
					};
				}),
				triangles: [...mesh.triangles],
				topology: mesh.generator.topology === "alpha-contour" ? "alpha-contour" : "rect-grid"
			};
		};
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/skinning.ts
	function applySkinningToVertex(vertex, skinning, transforms) {
		const weights = skinning.vertexWeights[vertex.id] ?? [];
		let x = 0;
		let y = 0;
		let total = 0;
		for (const influence of weights) {
			const matrix = transforms.get(influence.deformerId);
			if (!matrix || !Number.isFinite(influence.weight)) continue;
			const point = transformMatrixPoint(matrix, vertex.x, vertex.y);
			x += point.x * influence.weight;
			y += point.y * influence.weight;
			total += influence.weight;
		}
		return total > 0 ? {
			x: x / total,
			y: y / total
		} : {
			x: vertex.x,
			y: vertex.y
		};
	}
	/** Apply the same weighted result to a resolved ArtMesh vertex list. */
	function applySkinningToVertices(vertices, skinning, transforms) {
		if (!skinning || !transforms || !transforms.size) return vertices.map((vertex) => ({ ...vertex }));
		return vertices.map((vertex) => {
			const moved = applySkinningToVertex(vertex, skinning, transforms);
			return {
				...vertex,
				x: moved.x,
				y: moved.y
			};
		});
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/glue.ts
	function readRigGlue(rig) {
		return Array.isArray(rig.glue) ? rig.glue : [];
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/glueWarp.ts
	function resolveGlueWarpForPart(rig, part, state, size, computed, sizeForPart) {
		const gluePins = gluePinsForPart(rig, part, state, size, computed, sizeForPart);
		if (!gluePins.length) return state.warp;
		const warp = state.warp ? cloneWarp(state.warp) : emptyGlueWarp();
		warp.enabled = true;
		warp.grid = {
			columns: Math.max(warp.grid.columns, 5),
			rows: Math.max(warp.grid.rows, 5)
		};
		warp.pins = [...warp.pins ?? [], ...gluePins];
		return warp;
	}
	function gluePinsForPart(rig, part, state, size, computed, sizeForPart) {
		const activeGlues = readRigGlue(rig).filter((glue) => glue.enabled && glue.status === "active" && glue.mode === "soft-seam").sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
		const pins = [];
		for (const glue of activeGlues) {
			const currentSide = glue.partAId === part.id ? "A" : glue.partBId === part.id ? "B" : "";
			if (!currentSide) continue;
			const otherPartId = currentSide === "A" ? glue.partBId : glue.partAId;
			const otherPart = rig.parts.find((entry) => entry.id === otherPartId);
			const otherState = otherPart ? computed.get(otherPart.id) : void 0;
			const otherSize = otherPart ? sizeForPart(otherPart) : void 0;
			if (!otherPart || !otherState || !otherSize || !otherState.visible || otherState.opacity <= 0) continue;
			if (glue.seamPoints?.length) glue.seamPoints.forEach((point, index) => {
				const pointWeight = currentSide === "A" ? point.weightA ?? glue.weightA : point.weightB ?? glue.weightB;
				const pin = gluePinForSeamPoint(glue.id, index, currentSide, point, pointWeight, glueBlendStrength(glue, state.parameterValues), state, size, otherState, otherSize);
				if (pin) pins.push(pin);
			});
			else {
				const pin = gluePinForPair(glue.id, currentSide === "A" ? glue.weightA : glue.weightB, glueBlendStrength(glue, state.parameterValues), state, size, otherState, otherSize);
				if (pin) pins.push(pin);
			}
		}
		return pins.slice(0, 24);
	}
	function gluePinForSeamPoint(glueId, index, currentSide, point, weight, glueStrength, state, size, otherState, otherSize) {
		const currentUv = currentSide === "A" ? point.a : point.b;
		const otherUv = currentSide === "A" ? point.b : point.a;
		const left = -state.pose.pivotX * size.width;
		const top = -state.pose.pivotY * size.height;
		const otherLeft = -otherState.pose.pivotX * otherSize.width;
		const otherTop = -otherState.pose.pivotY * otherSize.height;
		const anchor = {
			x: left + clamp01$2(currentUv.u) * size.width,
			y: top + clamp01$2(currentUv.v) * size.height
		};
		const otherAnchorWorld = transformMatrixPoint(otherState.matrix, otherLeft + clamp01$2(otherUv.u) * otherSize.width, otherTop + clamp01$2(otherUv.v) * otherSize.height);
		const otherAnchorLocal = transformMatrixPoint(invertMatrix(state.matrix), otherAnchorWorld.x, otherAnchorWorld.y);
		const vector = {
			x: otherAnchorLocal.x - anchor.x,
			y: otherAnchorLocal.y - anchor.y
		};
		const length = Math.hypot(vector.x, vector.y);
		if (length < .001) return;
		const direction = {
			x: vector.x / length,
			y: vector.y / length
		};
		const clampedWeight = clamp01$2(weight);
		const clampedStrength = clamp01$2(point.strength ?? glueStrength);
		const maxOffset = clamp$1(Math.min(size.width, size.height) * .06, 2, 28);
		const magnitude = Math.min(length * .24, maxOffset) * clampedStrength * (.35 + clampedWeight * .65);
		if (magnitude < .05) return;
		return {
			id: `glue-${glueId}-${index}`,
			name: `Glue ${glueId} ${index + 1}`,
			enabled: true,
			u: clamp01$2(currentUv.u),
			v: clamp01$2(currentUv.v),
			offsetX: direction.x * magnitude,
			offsetY: direction.y * magnitude,
			radius: clamp$1(point.radius ?? .16 + clampedStrength * .34, .08, .7),
			strength: clamp$1(.14 + clampedStrength * (.42 + clampedWeight * .28), .14, .72),
			bindings: []
		};
	}
	function gluePinForPair(glueId, weight, strength, state, size, otherState, otherSize) {
		const left = -state.pose.pivotX * size.width;
		const top = -state.pose.pivotY * size.height;
		const center = {
			x: left + size.width * .5,
			y: top + size.height * .5
		};
		const otherCenterWorld = partCenterWorld(otherState, otherSize);
		const otherCenterLocal = transformMatrixPoint(invertMatrix(state.matrix), otherCenterWorld.x, otherCenterWorld.y);
		const vector = {
			x: otherCenterLocal.x - center.x,
			y: otherCenterLocal.y - center.y
		};
		const length = Math.hypot(vector.x, vector.y);
		if (length < .001) return;
		const direction = {
			x: vector.x / length,
			y: vector.y / length
		};
		const edgeDistance = rayToRectEdgeDistance(direction, size.width, size.height);
		const anchor = {
			x: center.x + direction.x * edgeDistance,
			y: center.y + direction.y * edgeDistance
		};
		const u = clamp01$2((anchor.x - left) / size.width);
		const v = clamp01$2((anchor.y - top) / size.height);
		const clampedWeight = clamp01$2(weight);
		const clampedStrength = clamp01$2(strength);
		const magnitude = clamp$1(Math.min(size.width, size.height) * .045, 2, 24) * clampedStrength * (.35 + clampedWeight * .65);
		if (magnitude < .05) return;
		return {
			id: `glue-${glueId}`,
			name: `Glue ${glueId}`,
			enabled: true,
			u,
			v,
			offsetX: direction.x * magnitude,
			offsetY: direction.y * magnitude,
			radius: clamp$1(.18 + clampedStrength * .34, .18, .52),
			strength: clamp$1(.16 + clampedStrength * (.34 + clampedWeight * .32), .16, .66),
			bindings: []
		};
	}
	function partCenterWorld(state, size) {
		const localX = -state.pose.pivotX * size.width + size.width * .5;
		const localY = -state.pose.pivotY * size.height + size.height * .5;
		return transformMatrixPoint(state.matrix, localX, localY);
	}
	function rayToRectEdgeDistance(direction, width, height) {
		const halfWidth = Math.max(.001, width * .5);
		const halfHeight = Math.max(.001, height * .5);
		const tx = Math.abs(direction.x) > .001 ? halfWidth / Math.abs(direction.x) : Number.POSITIVE_INFINITY;
		const ty = Math.abs(direction.y) > .001 ? halfHeight / Math.abs(direction.y) : Number.POSITIVE_INFINITY;
		return Math.min(tx, ty);
	}
	function emptyGlueWarp() {
		return {
			enabled: true,
			bendX: 0,
			bendY: 0,
			taperX: 0,
			taperY: 0,
			grid: {
				columns: 5,
				rows: 5
			},
			pins: []
		};
	}
	function cloneWarp(warp) {
		return {
			enabled: warp.enabled || hasWarpEffect(warp),
			bendX: warp.bendX,
			bendY: warp.bendY,
			taperX: warp.taperX,
			taperY: warp.taperY,
			grid: { ...warp.grid },
			pins: (warp.pins ?? []).map((pin) => ({
				...pin,
				bindings: (pin.bindings ?? []).map((binding) => ({
					...binding,
					keys: binding.keys.map((key) => ({ ...key }))
				}))
			}))
		};
	}
	function clamp01$2(value) {
		return clamp$1(value, 0, 1);
	}
	function clamp$1(value, min, max) {
		return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/sharedWarpProjection.ts
	/**
	* Converts a part-local point through its evaluated matrix, applies every
	* enabled shared field in stable parent-to-child order in stage coordinates,
	* then returns the renderer/output coordinate.
	*/
	function projectSharedWarpPoint(point, partMatrix, baseMatrix, fields) {
		const rendered = transformMatrixPoint(partMatrix, point.x, point.y);
		if (!fields?.some(hasSharedWarpFieldEffect)) return rendered;
		let stagePoint = transformMatrixPoint(invertMatrix(baseMatrix), rendered.x, rendered.y);
		for (const field of fields) if (hasSharedWarpFieldEffect(field)) stagePoint = warpSharedFieldPoint(field, stagePoint.x, stagePoint.y);
		return transformMatrixPoint(baseMatrix, stagePoint.x, stagePoint.y);
	}
	/** Frame-scoped projector: callers rebuild it after transforms or fields change. */
	function createSharedWarpProjector(partMatrix, baseMatrix, fields) {
		const part = { ...partMatrix }, base = { ...baseMatrix };
		const samplers = (fields ?? []).filter(hasSharedWarpFieldEffect).map(createSharedWarpSampler);
		const inverseBase = samplers.length ? invertMatrix(base) : void 0;
		return (point) => {
			const rendered = transformMatrixPoint(part, point.x, point.y);
			if (!inverseBase) return rendered;
			let stage = transformMatrixPoint(inverseBase, rendered.x, rendered.y);
			for (const sample of samplers) {
				const offset = sample(stage.x, stage.y);
				stage = {
					x: stage.x + offset.x,
					y: stage.y + offset.y
				};
			}
			return transformMatrixPoint(base, stage.x, stage.y);
		};
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/glueVertex.ts
	/**
	* Vertex-level glue ("stitch").
	*
	* `soft-seam` glue generates warp pins that pull a part a fraction of the way toward its neighbour,
	* so a seam driven hard enough always opens again. A stitch instead binds named ArtMesh vertices of
	* two parts: after every deformer, warp, skinning and shared-warp step has run, each bound pair is
	* forced back to the offset it had at neutral, so the two meshes cannot drift apart no matter how
	* far the motion travels. A pair with a zero rest offset collapses onto one point, which is the
	* classic glue behaviour for vertices authored to coincide.
	*
	* The solver is deliberately renderer-agnostic. Canvas, the server renderer and WebGL all hand it
	* the same projected vertex positions and all apply the same returned screen-space corrections, so
	* the three paths cannot drift apart.
	*/
	var ZERO_OFFSET_EPSILON = 1e-6;
	var DEFAULT_ITERATIONS = 16;
	var DEFAULT_RELAXATION = .7;
	/**
	* Project an ArtMesh vertex to screen space exactly the way the draw paths do: local offset from
	* the pivot, then the part warp, then the shared-warp/matrix projection. Renderers and the solver
	* must agree here or the stitch would be computed against positions nothing actually draws.
	*/
	function projectArtMeshVertex(vertex, context) {
		const left = -context.pose.pivotX * context.sourceWidth;
		const top = -context.pose.pivotY * context.sourceHeight;
		const local = {
			x: left + vertex.x,
			y: top + vertex.y
		};
		const bounds = {
			left,
			top,
			width: context.sourceWidth,
			height: context.sourceHeight
		};
		return projectSharedWarpPoint(context.warp && hasWarpEffect(context.warp) ? warpPoint(local.x, local.y, bounds, context.warp) : local, context.matrix, context.baseMatrix, context.sharedWarps);
	}
	function isStitchGlue(glue) {
		return glue.enabled && glue.status === "active" && glue.mode === "stitch" && Boolean(glue.vertexPairs?.length);
	}
	function collectGlueStitchPairs(rig, values = {}) {
		const pairs = [];
		const glues = readRigGlue(rig).filter(isStitchGlue).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
		for (const glue of glues) for (const pair of glue.vertexPairs ?? []) pairs.push({
			glueId: glue.id,
			strength: glueBlendStrength(glue, values),
			partAId: glue.partAId,
			partBId: glue.partBId,
			aVertexId: pair.a,
			bVertexId: pair.b,
			weight: clamp01$1(pair.weight ?? weightFromGlue(glue)),
			restDx: Number.isFinite(pair.restDx) ? pair.restDx : 0,
			restDy: Number.isFinite(pair.restDy) ? pair.restDy : 0
		});
		return pairs;
	}
	/** True when the document has any stitch work to do, so renderers can skip the solver entirely. */
	function hasGlueStitches(rig) {
		return readRigGlue(rig).some(isStitchGlue);
	}
	/**
	* Resolve the screen-space correction for every stitched vertex.
	*
	* Gauss-Seidel relaxation. A single pass is enough when every vertex belongs to one seam; extra
	* passes let a vertex shared by two seams settle on a position that satisfies both, instead of
	* whichever seam happened to be solved last silently winning.
	*/
	function resolveGlueStitchOffsets(rig, input) {
		const pairs = collectGlueStitchPairs(rig, input.values).filter((p) => p.strength > 0);
		const offsets = /* @__PURE__ */ new Map();
		let resolvedPairs = 0;
		let skippedPairs = 0;
		let maxClosedDistance = 0;
		if (!pairs.length) return {
			offsets,
			resolvedPairs,
			skippedPairs,
			maxClosedDistance,
			maxResidual: 0,
			iterations: 0
		};
		const restScale = Number.isFinite(input.restScale) && input.restScale > 0 ? input.restScale : 1;
		const iterations = Math.max(1, Math.min(64, Math.round(Number.isFinite(input.iterations) ? input.iterations : DEFAULT_ITERATIONS)));
		const relaxation = Math.min(1, Math.max(.05, Number.isFinite(input.relaxation) ? input.relaxation : DEFAULT_RELAXATION));
		const corrected = (partId, vertexId, base) => {
			const offset = offsets.get(partId)?.get(vertexId);
			return offset ? {
				x: base.x + offset.dx,
				y: base.y + offset.dy
			} : base;
		};
		const setOffset = (partId, vertexId, target, base) => {
			const dx = target.x - base.x;
			const dy = target.y - base.y;
			if (Math.abs(dx) < ZERO_OFFSET_EPSILON && Math.abs(dy) < ZERO_OFFSET_EPSILON) {
				offsets.get(partId)?.delete(vertexId);
				return;
			}
			let byVertex = offsets.get(partId);
			if (!byVertex) {
				byVertex = /* @__PURE__ */ new Map();
				offsets.set(partId, byVertex);
			}
			byVertex.set(vertexId, {
				dx,
				dy
			});
		};
		const basePoints = /* @__PURE__ */ new Map();
		const baseFor = (partId, vertexId) => {
			const key = partId + " " + vertexId;
			if (basePoints.has(key)) return basePoints.get(key);
			const point = input.projectVertex(partId, vertexId);
			const usable = point && isFinitePoint(point) ? point : void 0;
			basePoints.set(key, usable);
			return usable;
		};
		const solvable = [];
		for (const pair of pairs) {
			const baseA = baseFor(pair.partAId, pair.aVertexId);
			const baseB = baseFor(pair.partBId, pair.bVertexId);
			if (!baseA || !baseB) {
				skippedPairs += 1;
				continue;
			}
			solvable.push({
				...pair,
				baseA,
				baseB
			});
			resolvedPairs += 1;
		}
		let maxResidual = 0;
		for (let pass = 0; pass < iterations; pass += 1) {
			maxResidual = 0;
			for (const pair of solvable) {
				const currentA = corrected(pair.partAId, pair.aVertexId, pair.baseA);
				const currentB = corrected(pair.partBId, pair.bVertexId, pair.baseB);
				const errorX = currentB.x - currentA.x - (pair.restDx * restScale * pair.strength + (pair.baseB.x - pair.baseA.x) * (1 - pair.strength));
				const errorY = currentB.y - currentA.y - (pair.restDy * restScale * pair.strength + (pair.baseB.y - pair.baseA.y) * (1 - pair.strength));
				const drift = Math.hypot(errorX, errorY);
				if (pass === 0 && drift > maxClosedDistance) maxClosedDistance = drift;
				if (drift > maxResidual) maxResidual = drift;
				const stepX = errorX * relaxation;
				const stepY = errorY * relaxation;
				const targetA = {
					x: currentA.x + stepX * pair.weight,
					y: currentA.y + stepY * pair.weight
				};
				const targetB = {
					x: currentB.x - stepX * (1 - pair.weight),
					y: currentB.y - stepY * (1 - pair.weight)
				};
				if (!isFinitePoint(targetA) || !isFinitePoint(targetB)) continue;
				setOffset(pair.partAId, pair.aVertexId, targetA, pair.baseA);
				setOffset(pair.partBId, pair.bVertexId, targetB, pair.baseB);
			}
			if (maxResidual < ZERO_OFFSET_EPSILON) break;
		}
		return {
			offsets,
			resolvedPairs,
			skippedPairs,
			maxClosedDistance,
			maxResidual,
			iterations
		};
	}
	/** Same correction when the caller already holds the map for one part, as the draw loops do. */
	function applyPartGlueStitchOffset(offsets, vertexId, point) {
		const offset = offsets?.get(vertexId);
		return offset ? {
			x: point.x + offset.dx,
			y: point.y + offset.dy
		} : point;
	}
	/** Uniform scale carried by a base matrix, used to bring stage-unit rest offsets into screen units. */
	function glueStitchRestScale(matrix) {
		const determinant = Math.abs(matrix.a * matrix.d - matrix.b * matrix.c);
		return Number.isFinite(determinant) && determinant > 0 ? Math.sqrt(determinant) : 1;
	}
	function weightFromGlue(glue) {
		const total = glue.weightA + glue.weightB;
		return total > 0 ? glue.weightB / total : .5;
	}
	function isFinitePoint(point) {
		return Number.isFinite(point.x) && Number.isFinite(point.y);
	}
	function clamp01$1(value) {
		return Math.min(1, Math.max(0, Number.isFinite(value) ? value : .5));
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/mask.ts
	/**
	* Resolves the closest clip owner from a renderable part up through its part
	* parents. This lets related interior layers share one alpha-union mask without
	* applying it separately to every overlapping layer.
	*/
	function createPartClipResolver(rig) {
		const partsById = new Map(rig.parts.map((entry) => [entry.id, entry]));
		const cache = /* @__PURE__ */ new Map();
		const resolve = (part) => {
			if (cache.has(part.id)) return cache.get(part.id);
			const visited = /* @__PURE__ */ new Set();
			let current = part;
			let result;
			while (current && !visited.has(current.id)) {
				visited.add(current.id);
				if (cache.has(current.id)) {
					result = cache.get(current.id);
					break;
				}
				if (current.clip) {
					const maskPartIds = clipMaskPartIds(current.clip);
					const maskParts = maskPartIds.map((id) => partsById.get(id));
					if (maskPartIds.length && maskParts.every((maskPart) => maskPart?.kind === "image" && maskPart.assetId)) result = {
						owner: current,
						clip: current.clip,
						maskPartIds,
						maskParts
					};
					break;
				}
				current = current.parentId ? partsById.get(current.parentId) : void 0;
			}
			for (const id of visited) cache.set(id, result);
			return result;
		};
		return resolve;
	}
	function clipMaskPartIds(clip) {
		const ids = Array.isArray(clip.maskPartIds) ? clip.maskPartIds : clip.maskPartId ? [clip.maskPartId] : [];
		return [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/artPath.ts
	function readRigArtPaths(part) {
		return Array.isArray(part.artPaths) ? part.artPaths : [];
	}
	function normalizeArtPath(path, fallbackId = "art-path") {
		path.version = 1;
		path.id = typeof path.id === "string" && path.id.trim() ? path.id : fallbackId;
		path.name = typeof path.name === "string" && path.name.trim() ? path.name : path.id;
		path.enabled = path.enabled !== false;
		path.closed = path.closed === true;
		path.curve = path.curve === "smooth" ? "smooth" : "polyline";
		path.strokeColor = normalizeColor(path.strokeColor);
		path.strokeWidth = clamp(Number(path.strokeWidth), .25, 64, 2);
		path.opacity = clamp(Number(path.opacity), 0, 1, 1);
		path.points = Array.isArray(path.points) ? path.points.filter((point) => Boolean(point && typeof point.id === "string")).slice(0, 128).map((point, index) => normalizePoint(point, index)) : [];
		path.bindings = Array.isArray(path.bindings) ? path.bindings.slice(0, 32) : [];
		return path;
	}
	function resolveArtPath(path, values, width, height) {
		normalizeArtPath(path);
		if (!path.enabled || path.points.length < 2) return void 0;
		const pointValues = path.points.map((point) => {
			let u = point.u;
			let v = point.v;
			for (const binding of point.bindings ?? []) {
				const sampled = sampleBinding(binding, values[binding.parameter] ?? 0);
				if (binding.property === "u") u += sampled / Math.max(1, width);
				else v += sampled / Math.max(1, height);
			}
			for (const shape of path.blendShapes ?? []) {
				const delta = shape.points?.find((p) => p.id === point.id);
				if (delta) {
					const w = blendWeight(shape, values);
					u += delta.x * w;
					v += delta.y * w;
				}
			}
			return {
				id: point.id,
				u: clamp(u, 0, 1, point.u),
				v: clamp(v, 0, 1, point.v)
			};
		});
		let offsetX = 0;
		let offsetY = 0;
		let strokeWidth = path.strokeWidth;
		let opacity = path.opacity;
		for (const binding of path.bindings ?? []) {
			const sampled = sampleBinding(binding, values[binding.parameter] ?? 0);
			if (binding.property === "offsetX") offsetX += sampled / Math.max(1, width);
			else if (binding.property === "offsetY") offsetY += sampled / Math.max(1, height);
			else if (binding.property === "width") strokeWidth += sampled;
			else if (binding.property === "opacity") opacity += sampled;
		}
		for (const shape of path.blendShapes ?? []) {
			const w = blendWeight(shape, values);
			strokeWidth += (shape.width ?? 0) * w;
			opacity += (shape.opacity ?? 0) * w;
		}
		return {
			id: path.id,
			points: pointValues.map((point) => ({
				...point,
				u: clamp(point.u + offsetX, 0, 1, point.u),
				v: clamp(point.v + offsetY, 0, 1, point.v)
			})),
			closed: path.closed === true,
			curve: path.curve === "smooth" ? "smooth" : "polyline",
			strokeColor: parseColor(path.strokeColor, opacity),
			strokeWidth: clamp(strokeWidth, .25, 64, path.strokeWidth),
			opacity: clamp(opacity, 0, 1, path.opacity)
		};
	}
	function normalizePoint(point, index) {
		point.id = point.id.trim() || `point-${index + 1}`;
		point.u = clamp(Number(point.u), 0, 1, 0);
		point.v = clamp(Number(point.v), 0, 1, 0);
		point.bindings = Array.isArray(point.bindings) ? point.bindings.slice(0, 16) : [];
		return point;
	}
	function normalizeColor(value) {
		return typeof value === "string" && /^#[0-9a-f]{6,8}$/i.test(value) ? value : "#20202aff";
	}
	function parseColor(value, opacity) {
		const normalized = normalizeColor(value).slice(1);
		const hex = normalized.length === 6 ? normalized + "ff" : normalized;
		return [
			parseInt(hex.slice(0, 2), 16),
			parseInt(hex.slice(2, 4), 16),
			parseInt(hex.slice(4, 6), 16),
			Math.round(parseInt(hex.slice(6, 8), 16) * clamp(opacity, 0, 1, 1))
		];
	}
	function clamp(value, min, max, fallback) {
		return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
	}
	//#endregion
	//#region scripts/evaluation/path-geometry.ts
	function pathGeometry(part, values, context) {
		const scale = Math.max(.01, Math.sqrt(Math.abs(context.matrix.a * context.matrix.d - context.matrix.b * context.matrix.c)));
		return readRigArtPaths(part).flatMap((path) => {
			const p = resolveArtPath(path, values, context.sourceWidth, context.sourceHeight);
			if (!p) return [];
			const points = p.points.map((v) => projectArtMeshVertex({
				x: v.u * context.sourceWidth,
				y: v.v * context.sourceHeight
			}, context));
			const centers = [];
			const segment = (a, b) => {
				const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 1.5));
				if (!Number.isFinite(count) || centers.length + count + 1 > 1e5) throw Error("path stamp budget exceeded");
				for (let i = 0; i <= count; i++) {
					const t = i / count;
					centers.push({
						x: a.x + (b.x - a.x) * t,
						y: a.y + (b.y - a.y) * t
					});
				}
			};
			if (p.curve === "smooth" && points.length > 2) for (let i = 0; i < points.length - 1; i++) {
				const a = points[i], b = points[i + 1], count = Math.max(4, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
				let last = a;
				for (let j = 1; j <= count; j++) {
					const t = j / count, s = 1 - t;
					const next = {
						x: s * s * a.x + 2 * s * t * a.x + t * t * b.x,
						y: s * s * a.y + 2 * s * t * a.y + t * t * b.y
					};
					segment(last, next);
					last = next;
				}
			}
			else for (let i = 1; i < points.length; i++) segment(points[i - 1], points[i]);
			if (p.closed) segment(points[points.length - 1], points[0]);
			return [{
				id: p.id,
				color: p.strokeColor,
				radius: Math.max(.5, Math.max(.5, p.strokeWidth * scale) / 2),
				centers
			}];
		});
	}
	//#endregion
	//#region scripts/evaluation/final-geometry.ts
	function finalGeometry(rig, frame, baseMatrix, parts) {
		const assets = new Map(rig.assets.map((a) => [a.id, a]));
		const sourceParts = new Map(rig.parts.map((p) => [p.id, p]));
		const geometries = /* @__PURE__ */ new Map();
		const unsupported = [];
		const resolveClip = createPartClipResolver(rig);
		for (const part of rig.parts) if (part.clip) {
			const ids = clipMaskPartIds(part.clip);
			if (part.clip.mode !== "alpha" || !ids.length || ids.some((id) => {
				const p = sourceParts.get(id);
				return !p || p.kind !== "image" || !p.assetId;
			}) || ![
				void 0,
				"rendered",
				"ignore"
			].includes(part.clip.maskOpacity)) throw Error("invalid clip " + part.id);
		}
		for (const entry of parts) {
			const part = sourceParts.get(entry.id);
			if (part.kind !== "image") continue;
			const asset = assets.get(part.assetId);
			if (!entry.state || !asset || !(asset.width > 0 && asset.height > 0)) {
				unsupported.push({
					partId: entry.id,
					reason: "missing-asset-or-state"
				});
				continue;
			}
			if (!entry.localMesh && part.artMesh?.enabled) {
				unsupported.push({
					partId: entry.id,
					reason: "invalid-enabled-artmesh"
				});
				continue;
			}
			const warp = resolveGlueWarpForPart(rig, part, entry.state, asset, frame.parts, (p) => assets.get(p.assetId));
			const mesh = entry.localMesh ?? imageGrid(asset, warp, entry.state.sharedWarps);
			if (mesh.triangles.length % 3 || mesh.triangles.some((i) => !Number.isInteger(i) || i < 0 || i >= mesh.vertices.length)) throw Error("invalid triangle reference " + entry.id);
			const ids = /* @__PURE__ */ new Set();
			for (const v of mesh.vertices) {
				if (ids.has(v.id) || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.u) || !Number.isFinite(v.v)) throw Error("invalid mesh vertex " + entry.id);
				ids.add(v.id);
			}
			const context = {
				pose: entry.state.pose,
				matrix: entry.state.matrix,
				baseMatrix,
				sharedWarps: entry.state.sharedWarps,
				warp,
				sourceWidth: asset.width,
				sourceHeight: asset.height
			};
			const sharedProject = createSharedWarpProjector(context.matrix, context.baseMatrix, context.sharedWarps);
			const left = -context.pose.pivotX * asset.width, top = -context.pose.pivotY * asset.height;
			const bounds = {
				left,
				top,
				width: asset.width,
				height: asset.height
			}, warped = hasWarpEffect(warp);
			const vertices = mesh.vertices.map((v) => {
				const local = {
					x: left + v.x,
					y: top + v.y
				};
				const p = sharedProject(warped ? warpPoint(local.x, local.y, bounds, warp) : local);
				return {
					x: p.x,
					y: p.y,
					id: v.id,
					u: v.u,
					v: v.v
				};
			});
			const clip = resolveClip(part);
			geometries.set(entry.id, {
				entry,
				part,
				mesh,
				paths: pathGeometry(part, frame.values, context),
				clip: clip ? {
					ownerId: clip.owner.id,
					maskPartIds: clip.maskPartIds,
					maskOpacity: clip.clip.maskOpacity ?? "rendered"
				} : null,
				vertices,
				byId: void 0
			});
		}
		const stitches = hasGlueStitches(rig) ? resolveGlueStitchOffsets(rig, {
			values: frame.values,
			restScale: glueStitchRestScale(baseMatrix),
			projectVertex: (partId, vertexId) => {
				const g = geometries.get(partId);
				if (!g || !g.entry.localMesh || !g.entry.state.visible || !(g.entry.state.opacity > 0)) return void 0;
				if (!g.byId) {
					g.byId = /* @__PURE__ */ new Map();
					for (const v of g.vertices) g.byId.set(v.id, v);
				}
				return g.byId.get(vertexId);
			}
		}) : void 0;
		return {
			contract: 1,
			coordinateSpace: "projected",
			stage: "post-warp-and-glue",
			meshes: [...geometries.values()].map((g) => ({
				partId: g.part.id,
				assetId: g.part.assetId,
				drawOrder: g.part.drawOrder,
				blendMode: g.part.blendMode ?? "normal",
				visible: g.entry.state.visible,
				opacity: g.entry.state.opacity,
				clip: g.clip,
				geometrySource: g.entry.localMesh ? "artmesh" : "image-grid",
				vertices: stitchedVertices(g, stitches?.offsets.get(g.part.id)),
				triangles: g.mesh.triangles,
				paths: g.paths
			})),
			unsupported,
			stitchDiagnostics: stitches ? {
				resolvedPairs: stitches.resolvedPairs,
				skippedPairs: stitches.skippedPairs,
				maxResidual: stitches.maxResidual
			} : null,
			rendererReady: false
		};
	}
	function stitchedVertices(g, offsets) {
		if (!g.entry.localMesh || !offsets?.size) return g.vertices;
		return g.vertices.map((v) => {
			if (!offsets.has(v.id)) return v;
			const p = applyPartGlueStitchOffset(offsets, v.id, v);
			return {
				x: p.x,
				y: p.y,
				id: v.id,
				u: v.u,
				v: v.v
			};
		});
	}
	function imageGrid(asset, warp, sharedWarps = []) {
		const fields = sharedWarps.filter(hasSharedWarpFieldEffect);
		const columns = Math.max(1, Math.round(warp?.grid.columns ?? 1), ...fields.map((f) => f.grid.columns));
		const rows = Math.max(1, Math.round(warp?.grid.rows ?? 1), ...fields.map((f) => f.grid.rows));
		if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns > 64 || rows > 64) throw Error("invalid image grid");
		const vertices = [], triangles = [];
		for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) vertices.push({
			id: `image-${x}-${y}`,
			x: asset.width * x / columns,
			y: asset.height * y / rows,
			u: x / columns,
			v: y / rows
		});
		for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
			const a = y * (columns + 1) + x;
			triangles.push(a, a + 1, a + columns + 2, a, a + columns + 2, a + columns + 1);
		}
		return {
			vertices,
			triangles
		};
	}
	//#endregion
	//#region scripts/evaluation/finite-packet.ts
	function validateFinitePacket(packet) {
		const stack = [packet], seen = /* @__PURE__ */ new WeakSet();
		while (stack.length) {
			const value = stack.pop();
			if (typeof value === "number") {
				if (!Number.isFinite(value)) throw Error("non-finite evaluation");
				continue;
			}
			if (!value || typeof value !== "object" || seen.has(value)) continue;
			seen.add(value);
			for (const key in value) {
				if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
				const item = value[key];
				if (typeof item === "number") {
					if (!Number.isFinite(item)) throw Error("non-finite evaluation");
				} else if (item && typeof item === "object") stack.push(item);
			}
		}
	}
	Object.freeze({ status: "aborted" });
	function $constructor(name, initializer, params) {
		function init(inst, def) {
			if (!inst._zod) Object.defineProperty(inst, "_zod", {
				value: {
					def,
					constr: _,
					traits: /* @__PURE__ */ new Set()
				},
				enumerable: false
			});
			if (inst._zod.traits.has(name)) return;
			inst._zod.traits.add(name);
			initializer(inst, def);
			const proto = _.prototype;
			const keys = Object.keys(proto);
			for (let i = 0; i < keys.length; i++) {
				const k = keys[i];
				if (!(k in inst)) inst[k] = proto[k].bind(inst);
			}
		}
		const Parent = params?.Parent ?? Object;
		class Definition extends Parent {}
		Object.defineProperty(Definition, "name", { value: name });
		function _(def) {
			var _a;
			const inst = params?.Parent ? new Definition() : this;
			init(inst, def);
			(_a = inst._zod).deferred ?? (_a.deferred = []);
			for (const fn of inst._zod.deferred) fn();
			return inst;
		}
		Object.defineProperty(_, "init", { value: init });
		Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
			if (params?.Parent && inst instanceof params.Parent) return true;
			return inst?._zod?.traits?.has(name);
		} });
		Object.defineProperty(_, "name", { value: name });
		return _;
	}
	var $ZodAsyncError = class extends Error {
		constructor() {
			super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
		}
	};
	var $ZodEncodeError = class extends Error {
		constructor(name) {
			super(`Encountered unidirectional transform during encode: ${name}`);
			this.name = "ZodEncodeError";
		}
	};
	var globalConfig = {};
	function config(newConfig) {
		if (newConfig) Object.assign(globalConfig, newConfig);
		return globalConfig;
	}
	//#endregion
	//#region node_modules/zod/v4/core/util.js
	function getEnumValues(entries) {
		const numericValues = Object.values(entries).filter((v) => typeof v === "number");
		return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
	}
	function jsonStringifyReplacer(_, value) {
		if (typeof value === "bigint") return value.toString();
		return value;
	}
	function cached(getter) {
		return { get value() {
			{
				const value = getter();
				Object.defineProperty(this, "value", { value });
				return value;
			}
			throw new Error("cached value already set");
		} };
	}
	function nullish(input) {
		return input === null || input === void 0;
	}
	function cleanRegex(source) {
		const start = source.startsWith("^") ? 1 : 0;
		const end = source.endsWith("$") ? source.length - 1 : source.length;
		return source.slice(start, end);
	}
	function floatSafeRemainder(val, step) {
		const valDecCount = (val.toString().split(".")[1] || "").length;
		const stepString = step.toString();
		let stepDecCount = (stepString.split(".")[1] || "").length;
		if (stepDecCount === 0 && /\d?e-\d?/.test(stepString)) {
			const match = stepString.match(/\d?e-(\d?)/);
			if (match?.[1]) stepDecCount = Number.parseInt(match[1]);
		}
		const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
		return Number.parseInt(val.toFixed(decCount).replace(".", "")) % Number.parseInt(step.toFixed(decCount).replace(".", "")) / 10 ** decCount;
	}
	var EVALUATING = Symbol("evaluating");
	function defineLazy(object, key, getter) {
		let value = void 0;
		Object.defineProperty(object, key, {
			get() {
				if (value === EVALUATING) return;
				if (value === void 0) {
					value = EVALUATING;
					value = getter();
				}
				return value;
			},
			set(v) {
				Object.defineProperty(object, key, { value: v });
			},
			configurable: true
		});
	}
	function assignProp(target, prop, value) {
		Object.defineProperty(target, prop, {
			value,
			writable: true,
			enumerable: true,
			configurable: true
		});
	}
	function mergeDefs(...defs) {
		const mergedDescriptors = {};
		for (const def of defs) {
			const descriptors = Object.getOwnPropertyDescriptors(def);
			Object.assign(mergedDescriptors, descriptors);
		}
		return Object.defineProperties({}, mergedDescriptors);
	}
	function esc(str) {
		return JSON.stringify(str);
	}
	function slugify(input) {
		return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
	}
	var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
	function isObject(data) {
		return typeof data === "object" && data !== null && !Array.isArray(data);
	}
	var allowsEval = cached(() => {
		if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
		try {
			new Function("");
			return true;
		} catch (_) {
			return false;
		}
	});
	function isPlainObject(o) {
		if (isObject(o) === false) return false;
		const ctor = o.constructor;
		if (ctor === void 0) return true;
		if (typeof ctor !== "function") return true;
		const prot = ctor.prototype;
		if (isObject(prot) === false) return false;
		if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
		return true;
	}
	function shallowClone(o) {
		if (isPlainObject(o)) return { ...o };
		if (Array.isArray(o)) return [...o];
		return o;
	}
	var propertyKeyTypes = /* @__PURE__ */ new Set([
		"string",
		"number",
		"symbol"
	]);
	function escapeRegex(str) {
		return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
	function clone(inst, def, params) {
		const cl = new inst._zod.constr(def ?? inst._zod.def);
		if (!def || params?.parent) cl._zod.parent = inst;
		return cl;
	}
	function normalizeParams(_params) {
		const params = _params;
		if (!params) return {};
		if (typeof params === "string") return { error: () => params };
		if (params?.message !== void 0) {
			if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
			params.error = params.message;
		}
		delete params.message;
		if (typeof params.error === "string") return {
			...params,
			error: () => params.error
		};
		return params;
	}
	function optionalKeys(shape) {
		return Object.keys(shape).filter((k) => {
			return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
		});
	}
	var NUMBER_FORMAT_RANGES = {
		safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
		int32: [-2147483648, 2147483647],
		uint32: [0, 4294967295],
		float32: [-34028234663852886e22, 34028234663852886e22],
		float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
	};
	function pick(schema, mask) {
		const currDef = schema._zod.def;
		const checks = currDef.checks;
		if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
		return clone(schema, mergeDefs(schema._zod.def, {
			get shape() {
				const newShape = {};
				for (const key in mask) {
					if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
					if (!mask[key]) continue;
					newShape[key] = currDef.shape[key];
				}
				assignProp(this, "shape", newShape);
				return newShape;
			},
			checks: []
		}));
	}
	function omit(schema, mask) {
		const currDef = schema._zod.def;
		const checks = currDef.checks;
		if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
		return clone(schema, mergeDefs(schema._zod.def, {
			get shape() {
				const newShape = { ...schema._zod.def.shape };
				for (const key in mask) {
					if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
					if (!mask[key]) continue;
					delete newShape[key];
				}
				assignProp(this, "shape", newShape);
				return newShape;
			},
			checks: []
		}));
	}
	function extend(schema, shape) {
		if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
		const checks = schema._zod.def.checks;
		if (checks && checks.length > 0) {
			const existingShape = schema._zod.def.shape;
			for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
		}
		return clone(schema, mergeDefs(schema._zod.def, { get shape() {
			const _shape = {
				...schema._zod.def.shape,
				...shape
			};
			assignProp(this, "shape", _shape);
			return _shape;
		} }));
	}
	function safeExtend(schema, shape) {
		if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
		return clone(schema, mergeDefs(schema._zod.def, { get shape() {
			const _shape = {
				...schema._zod.def.shape,
				...shape
			};
			assignProp(this, "shape", _shape);
			return _shape;
		} }));
	}
	function merge(a, b) {
		return clone(a, mergeDefs(a._zod.def, {
			get shape() {
				const _shape = {
					...a._zod.def.shape,
					...b._zod.def.shape
				};
				assignProp(this, "shape", _shape);
				return _shape;
			},
			get catchall() {
				return b._zod.def.catchall;
			},
			checks: []
		}));
	}
	function partial(Class, schema, mask) {
		const checks = schema._zod.def.checks;
		if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
		return clone(schema, mergeDefs(schema._zod.def, {
			get shape() {
				const oldShape = schema._zod.def.shape;
				const shape = { ...oldShape };
				if (mask) for (const key in mask) {
					if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
					if (!mask[key]) continue;
					shape[key] = Class ? new Class({
						type: "optional",
						innerType: oldShape[key]
					}) : oldShape[key];
				}
				else for (const key in oldShape) shape[key] = Class ? new Class({
					type: "optional",
					innerType: oldShape[key]
				}) : oldShape[key];
				assignProp(this, "shape", shape);
				return shape;
			},
			checks: []
		}));
	}
	function required(Class, schema, mask) {
		return clone(schema, mergeDefs(schema._zod.def, { get shape() {
			const oldShape = schema._zod.def.shape;
			const shape = { ...oldShape };
			if (mask) for (const key in mask) {
				if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				shape[key] = new Class({
					type: "nonoptional",
					innerType: oldShape[key]
				});
			}
			else for (const key in oldShape) shape[key] = new Class({
				type: "nonoptional",
				innerType: oldShape[key]
			});
			assignProp(this, "shape", shape);
			return shape;
		} }));
	}
	function aborted(x, startIndex = 0) {
		if (x.aborted === true) return true;
		for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
		return false;
	}
	function prefixIssues(path, issues) {
		return issues.map((iss) => {
			var _a;
			(_a = iss).path ?? (_a.path = []);
			iss.path.unshift(path);
			return iss;
		});
	}
	function unwrapMessage(message) {
		return typeof message === "string" ? message : message?.message;
	}
	function finalizeIssue(iss, ctx, config) {
		const full = {
			...iss,
			path: iss.path ?? []
		};
		if (!iss.message) full.message = unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
		delete full.inst;
		delete full.continue;
		if (!ctx?.reportInput) delete full.input;
		return full;
	}
	function getLengthableOrigin(input) {
		if (Array.isArray(input)) return "array";
		if (typeof input === "string") return "string";
		return "unknown";
	}
	function issue(...args) {
		const [iss, input, inst] = args;
		if (typeof iss === "string") return {
			message: iss,
			code: "custom",
			input,
			inst
		};
		return { ...iss };
	}
	//#endregion
	//#region node_modules/zod/v4/core/errors.js
	var initializer$1 = (inst, def) => {
		inst.name = "$ZodError";
		Object.defineProperty(inst, "_zod", {
			value: inst._zod,
			enumerable: false
		});
		Object.defineProperty(inst, "issues", {
			value: def,
			enumerable: false
		});
		inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
		Object.defineProperty(inst, "toString", {
			value: () => inst.message,
			enumerable: false
		});
	};
	var $ZodError = $constructor("$ZodError", initializer$1);
	var $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
	function flattenError(error, mapper = (issue) => issue.message) {
		const fieldErrors = {};
		const formErrors = [];
		for (const sub of error.issues) if (sub.path.length > 0) {
			fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
			fieldErrors[sub.path[0]].push(mapper(sub));
		} else formErrors.push(mapper(sub));
		return {
			formErrors,
			fieldErrors
		};
	}
	function formatError(error, mapper = (issue) => issue.message) {
		const fieldErrors = { _errors: [] };
		const processError = (error) => {
			for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }));
			else if (issue.code === "invalid_key") processError({ issues: issue.issues });
			else if (issue.code === "invalid_element") processError({ issues: issue.issues });
			else if (issue.path.length === 0) fieldErrors._errors.push(mapper(issue));
			else {
				let curr = fieldErrors;
				let i = 0;
				while (i < issue.path.length) {
					const el = issue.path[i];
					if (!(i === issue.path.length - 1)) curr[el] = curr[el] || { _errors: [] };
					else {
						curr[el] = curr[el] || { _errors: [] };
						curr[el]._errors.push(mapper(issue));
					}
					curr = curr[el];
					i++;
				}
			}
		};
		processError(error);
		return fieldErrors;
	}
	//#endregion
	//#region node_modules/zod/v4/core/parse.js
	var _parse = (_Err) => (schema, value, _ctx, _params) => {
		const ctx = _ctx ? Object.assign(_ctx, { async: false }) : { async: false };
		const result = schema._zod.run({
			value,
			issues: []
		}, ctx);
		if (result instanceof Promise) throw new $ZodAsyncError();
		if (result.issues.length) {
			const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
			captureStackTrace(e, _params?.callee);
			throw e;
		}
		return result.value;
	};
	var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
		const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
		let result = schema._zod.run({
			value,
			issues: []
		}, ctx);
		if (result instanceof Promise) result = await result;
		if (result.issues.length) {
			const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
			captureStackTrace(e, params?.callee);
			throw e;
		}
		return result.value;
	};
	var _safeParse = (_Err) => (schema, value, _ctx) => {
		const ctx = _ctx ? {
			..._ctx,
			async: false
		} : { async: false };
		const result = schema._zod.run({
			value,
			issues: []
		}, ctx);
		if (result instanceof Promise) throw new $ZodAsyncError();
		return result.issues.length ? {
			success: false,
			error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
		} : {
			success: true,
			data: result.value
		};
	};
	var safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
	var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
		const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
		let result = schema._zod.run({
			value,
			issues: []
		}, ctx);
		if (result instanceof Promise) result = await result;
		return result.issues.length ? {
			success: false,
			error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
		} : {
			success: true,
			data: result.value
		};
	};
	var safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
	var _encode = (_Err) => (schema, value, _ctx) => {
		const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
		return _parse(_Err)(schema, value, ctx);
	};
	var _decode = (_Err) => (schema, value, _ctx) => {
		return _parse(_Err)(schema, value, _ctx);
	};
	var _encodeAsync = (_Err) => async (schema, value, _ctx) => {
		const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
		return _parseAsync(_Err)(schema, value, ctx);
	};
	var _decodeAsync = (_Err) => async (schema, value, _ctx) => {
		return _parseAsync(_Err)(schema, value, _ctx);
	};
	var _safeEncode = (_Err) => (schema, value, _ctx) => {
		const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
		return _safeParse(_Err)(schema, value, ctx);
	};
	var _safeDecode = (_Err) => (schema, value, _ctx) => {
		return _safeParse(_Err)(schema, value, _ctx);
	};
	var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
		const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
		return _safeParseAsync(_Err)(schema, value, ctx);
	};
	var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
		return _safeParseAsync(_Err)(schema, value, _ctx);
	};
	//#endregion
	//#region node_modules/zod/v4/core/regexes.js
	var cuid = /^[cC][^\s-]{8,}$/;
	var cuid2 = /^[0-9a-z]+$/;
	var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
	var xid = /^[0-9a-vA-V]{20}$/;
	var ksuid = /^[A-Za-z0-9]{27}$/;
	var nanoid = /^[a-zA-Z0-9_-]{21}$/;
	/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
	var duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
	/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
	var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
	/** Returns a regex for validating an RFC 9562/4122 UUID.
	*
	* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
	var uuid = (version) => {
		if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
		return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
	};
	/** Practical email validation */
	var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
	var _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
	function emoji() {
		return new RegExp(_emoji$1, "u");
	}
	var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
	var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
	var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
	var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
	var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
	var base64url = /^[A-Za-z0-9_-]*$/;
	var e164 = /^\+[1-9]\d{6,14}$/;
	var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
	var date$1 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
	function timeSource(args) {
		const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
		return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
	}
	function time$1(args) {
		return new RegExp(`^${timeSource(args)}$`);
	}
	function datetime$1(args) {
		const time = timeSource({ precision: args.precision });
		const opts = ["Z"];
		if (args.local) opts.push("");
		if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
		const timeRegex = `${time}(?:${opts.join("|")})`;
		return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
	}
	var string$1 = (params) => {
		const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
		return new RegExp(`^${regex}$`);
	};
	var integer = /^-?\d+$/;
	var number$1 = /^-?\d+(?:\.\d+)?$/;
	var boolean$1 = /^(?:true|false)$/i;
	var lowercase = /^[^A-Z]*$/;
	var uppercase = /^[^a-z]*$/;
	//#endregion
	//#region node_modules/zod/v4/core/checks.js
	var $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
		var _a;
		inst._zod ?? (inst._zod = {});
		inst._zod.def = def;
		(_a = inst._zod).onattach ?? (_a.onattach = []);
	});
	var numericOriginMap = {
		number: "number",
		bigint: "bigint",
		object: "date"
	};
	var $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
		$ZodCheck.init(inst, def);
		const origin = numericOriginMap[typeof def.value];
		inst._zod.onattach.push((inst) => {
			const bag = inst._zod.bag;
			const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
			if (def.value < curr) if (def.inclusive) bag.maximum = def.value;
			else bag.exclusiveMaximum = def.value;
		});
		inst._zod.check = (payload) => {
			if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
			payload.issues.push({
				origin,
				code: "too_big",
				maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
				input: payload.value,
				inclusive: def.inclusive,
				inst,
				continue: !def.abort
			});
		};
	});
	var $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
		$ZodCheck.init(inst, def);
		const origin = numericOriginMap[typeof def.value];
		inst._zod.onattach.push((inst) => {
			const bag = inst._zod.bag;
			const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
			if (def.value > curr) if (def.inclusive) bag.minimum = def.value;
			else bag.exclusiveMinimum = def.value;
		});
		inst._zod.check = (payload) => {
			if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
			payload.issues.push({
				origin,
				code: "too_small",
				minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
				input: payload.value,
				inclusive: def.inclusive,
				inst,
				continue: !def.abort
			});
		};
	});
	var $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
		$ZodCheck.init(inst, def);
		inst._zod.onattach.push((inst) => {
			var _a;
			(_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
		});
		inst._zod.check = (payload) => {
			if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
			if (typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
			payload.issues.push({
				origin: typeof payload.value,
				code: "not_multiple_of",
				divisor: def.value,
				input: payload.value,
				inst,
				continue: !def.abort
			});
		};
	});
	var $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
		$ZodCheck.init(inst, def);
		def.format = def.format || "float64";
		const isInt = def.format?.includes("int");
		const origin = isInt ? "int" : "number";
		const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
		inst._zod.onattach.push((inst) => {
			const bag = inst._zod.bag;
			bag.format = def.format;
			bag.minimum = minimum;
			bag.maximum = maximum;
			if (isInt) bag.pattern = integer;
		});
		inst._zod.check = (payload) => {
			const input = payload.value;
			if (isInt) {
				if (!Number.isInteger(input)) {
					payload.issues.push({
						expected: origin,
						format: def.format,
						code: "invalid_type",
						continue: false,
						input,
						inst
					});
					return;
				}
				if (!Number.isSafeInteger(input)) {
					if (input > 0) payload.issues.push({
						input,
						code: "too_big",
						maximum: Number.MAX_SAFE_INTEGER,
						note: "Integers must be within the safe integer range.",
						inst,
						origin,
						inclusive: true,
						continue: !def.abort
					});
					else payload.issues.push({
						input,
						code: "too_small",
						minimum: Number.MIN_SAFE_INTEGER,
						note: "Integers must be within the safe integer range.",
						inst,
						origin,
						inclusive: true,
						continue: !def.abort
					});
					return;
				}
			}
			if (input < minimum) payload.issues.push({
				origin: "number",
				input,
				code: "too_small",
				minimum,
				inclusive: true,
				inst,
				continue: !def.abort
			});
			if (input > maximum) payload.issues.push({
				origin: "number",
				input,
				code: "too_big",
				maximum,
				inclusive: true,
				inst,
				continue: !def.abort
			});
		};
	});
	var $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
		var _a;
		$ZodCheck.init(inst, def);
		(_a = inst._zod.def).when ?? (_a.when = (payload) => {
			const val = payload.value;
			return !nullish(val) && val.length !== void 0;
		});
		inst._zod.onattach.push((inst) => {
			const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
			if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
		});
		inst._zod.check = (payload) => {
			const input = payload.value;
			if (input.length <= def.maximum) return;
			const origin = getLengthableOrigin(input);
			payload.issues.push({
				origin,
				code: "too_big",
				maximum: def.maximum,
				inclusive: true,
				input,
				inst,
				continue: !def.abort
			});
		};
	});
	var $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
		var _a;
		$ZodCheck.init(inst, def);
		(_a = inst._zod.def).when ?? (_a.when = (payload) => {
			const val = payload.value;
			return !nullish(val) && val.length !== void 0;
		});
		inst._zod.onattach.push((inst) => {
			const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
			if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
		});
		inst._zod.check = (payload) => {
			const input = payload.value;
			if (input.length >= def.minimum) return;
			const origin = getLengthableOrigin(input);
			payload.issues.push({
				origin,
				code: "too_small",
				minimum: def.minimum,
				inclusive: true,
				input,
				inst,
				continue: !def.abort
			});
		};
	});
	var $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
		var _a;
		$ZodCheck.init(inst, def);
		(_a = inst._zod.def).when ?? (_a.when = (payload) => {
			const val = payload.value;
			return !nullish(val) && val.length !== void 0;
		});
		inst._zod.onattach.push((inst) => {
			const bag = inst._zod.bag;
			bag.minimum = def.length;
			bag.maximum = def.length;
			bag.length = def.length;
		});
		inst._zod.check = (payload) => {
			const input = payload.value;
			const length = input.length;
			if (length === def.length) return;
			const origin = getLengthableOrigin(input);
			const tooBig = length > def.length;
			payload.issues.push({
				origin,
				...tooBig ? {
					code: "too_big",
					maximum: def.length
				} : {
					code: "too_small",
					minimum: def.length
				},
				inclusive: true,
				exact: true,
				input: payload.value,
				inst,
				continue: !def.abort
			});
		};
	});
	var $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
		var _a, _b;
		$ZodCheck.init(inst, def);
		inst._zod.onattach.push((inst) => {
			const bag = inst._zod.bag;
			bag.format = def.format;
			if (def.pattern) {
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(def.pattern);
			}
		});
		if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
			def.pattern.lastIndex = 0;
			if (def.pattern.test(payload.value)) return;
			payload.issues.push({
				origin: "string",
				code: "invalid_format",
				format: def.format,
				input: payload.value,
				...def.pattern ? { pattern: def.pattern.toString() } : {},
				inst,
				continue: !def.abort
			});
		});
		else (_b = inst._zod).check ?? (_b.check = () => {});
	});
	var $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
		$ZodCheckStringFormat.init(inst, def);
		inst._zod.check = (payload) => {
			def.pattern.lastIndex = 0;
			if (def.pattern.test(payload.value)) return;
			payload.issues.push({
				origin: "string",
				code: "invalid_format",
				format: "regex",
				input: payload.value,
				pattern: def.pattern.toString(),
				inst,
				continue: !def.abort
			});
		};
	});
	var $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
		def.pattern ?? (def.pattern = lowercase);
		$ZodCheckStringFormat.init(inst, def);
	});
	var $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
		def.pattern ?? (def.pattern = uppercase);
		$ZodCheckStringFormat.init(inst, def);
	});
	var $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
		$ZodCheck.init(inst, def);
		const escapedRegex = escapeRegex(def.includes);
		const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
		def.pattern = pattern;
		inst._zod.onattach.push((inst) => {
			const bag = inst._zod.bag;
			bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
			bag.patterns.add(pattern);
		});
		inst._zod.check = (payload) => {
			if (payload.value.includes(def.includes, def.position)) return;
			payload.issues.push({
				origin: "string",
				code: "invalid_format",
				format: "includes",
				includes: def.includes,
				input: payload.value,
				inst,
				continue: !def.abort
			});
		};
	});
	var $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
		$ZodCheck.init(inst, def);
		const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
		def.pattern ?? (def.pattern = pattern);
		inst._zod.onattach.push((inst) => {
			const bag = inst._zod.bag;
			bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
			bag.patterns.add(pattern);
		});
		inst._zod.check = (payload) => {
			if (payload.value.startsWith(def.prefix)) return;
			payload.issues.push({
				origin: "string",
				code: "invalid_format",
				format: "starts_with",
				prefix: def.prefix,
				input: payload.value,
				inst,
				continue: !def.abort
			});
		};
	});
	var $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
		$ZodCheck.init(inst, def);
		const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
		def.pattern ?? (def.pattern = pattern);
		inst._zod.onattach.push((inst) => {
			const bag = inst._zod.bag;
			bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
			bag.patterns.add(pattern);
		});
		inst._zod.check = (payload) => {
			if (payload.value.endsWith(def.suffix)) return;
			payload.issues.push({
				origin: "string",
				code: "invalid_format",
				format: "ends_with",
				suffix: def.suffix,
				input: payload.value,
				inst,
				continue: !def.abort
			});
		};
	});
	var $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
		$ZodCheck.init(inst, def);
		inst._zod.check = (payload) => {
			payload.value = def.tx(payload.value);
		};
	});
	//#endregion
	//#region node_modules/zod/v4/core/doc.js
	var Doc = class {
		constructor(args = []) {
			this.content = [];
			this.indent = 0;
			if (this) this.args = args;
		}
		indented(fn) {
			this.indent += 1;
			fn(this);
			this.indent -= 1;
		}
		write(arg) {
			if (typeof arg === "function") {
				arg(this, { execution: "sync" });
				arg(this, { execution: "async" });
				return;
			}
			const lines = arg.split("\n").filter((x) => x);
			const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
			const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
			for (const line of dedented) this.content.push(line);
		}
		compile() {
			const F = Function;
			const args = this?.args;
			const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
			return new F(...args, lines.join("\n"));
		}
	};
	//#endregion
	//#region node_modules/zod/v4/core/versions.js
	var version = {
		major: 4,
		minor: 3,
		patch: 6
	};
	//#endregion
	//#region node_modules/zod/v4/core/schemas.js
	var $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
		var _a;
		inst ?? (inst = {});
		inst._zod.def = def;
		inst._zod.bag = inst._zod.bag || {};
		inst._zod.version = version;
		const checks = [...inst._zod.def.checks ?? []];
		if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
		for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
		if (checks.length === 0) {
			(_a = inst._zod).deferred ?? (_a.deferred = []);
			inst._zod.deferred?.push(() => {
				inst._zod.run = inst._zod.parse;
			});
		} else {
			const runChecks = (payload, checks, ctx) => {
				let isAborted = aborted(payload);
				let asyncResult;
				for (const ch of checks) {
					if (ch._zod.def.when) {
						if (!ch._zod.def.when(payload)) continue;
					} else if (isAborted) continue;
					const currLen = payload.issues.length;
					const _ = ch._zod.check(payload);
					if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
					if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
						await _;
						if (payload.issues.length === currLen) return;
						if (!isAborted) isAborted = aborted(payload, currLen);
					});
					else {
						if (payload.issues.length === currLen) continue;
						if (!isAborted) isAborted = aborted(payload, currLen);
					}
				}
				if (asyncResult) return asyncResult.then(() => {
					return payload;
				});
				return payload;
			};
			const handleCanaryResult = (canary, payload, ctx) => {
				if (aborted(canary)) {
					canary.aborted = true;
					return canary;
				}
				const checkResult = runChecks(payload, checks, ctx);
				if (checkResult instanceof Promise) {
					if (ctx.async === false) throw new $ZodAsyncError();
					return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
				}
				return inst._zod.parse(checkResult, ctx);
			};
			inst._zod.run = (payload, ctx) => {
				if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
				if (ctx.direction === "backward") {
					const canary = inst._zod.parse({
						value: payload.value,
						issues: []
					}, {
						...ctx,
						skipChecks: true
					});
					if (canary instanceof Promise) return canary.then((canary) => {
						return handleCanaryResult(canary, payload, ctx);
					});
					return handleCanaryResult(canary, payload, ctx);
				}
				const result = inst._zod.parse(payload, ctx);
				if (result instanceof Promise) {
					if (ctx.async === false) throw new $ZodAsyncError();
					return result.then((result) => runChecks(result, checks, ctx));
				}
				return runChecks(result, checks, ctx);
			};
		}
		defineLazy(inst, "~standard", () => ({
			validate: (value) => {
				try {
					const r = safeParse$1(inst, value);
					return r.success ? { value: r.data } : { issues: r.error?.issues };
				} catch (_) {
					return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
				}
			},
			vendor: "zod",
			version: 1
		}));
	});
	var $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
		$ZodType.init(inst, def);
		inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
		inst._zod.parse = (payload, _) => {
			if (def.coerce) try {
				payload.value = String(payload.value);
			} catch (_) {}
			if (typeof payload.value === "string") return payload;
			payload.issues.push({
				expected: "string",
				code: "invalid_type",
				input: payload.value,
				inst
			});
			return payload;
		};
	});
	var $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
		$ZodCheckStringFormat.init(inst, def);
		$ZodString.init(inst, def);
	});
	var $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
		def.pattern ?? (def.pattern = guid);
		$ZodStringFormat.init(inst, def);
	});
	var $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
		if (def.version) {
			const v = {
				v1: 1,
				v2: 2,
				v3: 3,
				v4: 4,
				v5: 5,
				v6: 6,
				v7: 7,
				v8: 8
			}[def.version];
			if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
			def.pattern ?? (def.pattern = uuid(v));
		} else def.pattern ?? (def.pattern = uuid());
		$ZodStringFormat.init(inst, def);
	});
	var $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
		def.pattern ?? (def.pattern = email);
		$ZodStringFormat.init(inst, def);
	});
	var $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
		$ZodStringFormat.init(inst, def);
		inst._zod.check = (payload) => {
			try {
				const trimmed = payload.value.trim();
				const url = new URL(trimmed);
				if (def.hostname) {
					def.hostname.lastIndex = 0;
					if (!def.hostname.test(url.hostname)) payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid hostname",
						pattern: def.hostname.source,
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
				if (def.protocol) {
					def.protocol.lastIndex = 0;
					if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid protocol",
						pattern: def.protocol.source,
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
				if (def.normalize) payload.value = url.href;
				else payload.value = trimmed;
				return;
			} catch (_) {
				payload.issues.push({
					code: "invalid_format",
					format: "url",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
		};
	});
	var $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
		def.pattern ?? (def.pattern = emoji());
		$ZodStringFormat.init(inst, def);
	});
	var $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
		def.pattern ?? (def.pattern = nanoid);
		$ZodStringFormat.init(inst, def);
	});
	var $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
		def.pattern ?? (def.pattern = cuid);
		$ZodStringFormat.init(inst, def);
	});
	var $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
		def.pattern ?? (def.pattern = cuid2);
		$ZodStringFormat.init(inst, def);
	});
	var $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
		def.pattern ?? (def.pattern = ulid);
		$ZodStringFormat.init(inst, def);
	});
	var $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
		def.pattern ?? (def.pattern = xid);
		$ZodStringFormat.init(inst, def);
	});
	var $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
		def.pattern ?? (def.pattern = ksuid);
		$ZodStringFormat.init(inst, def);
	});
	var $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
		def.pattern ?? (def.pattern = datetime$1(def));
		$ZodStringFormat.init(inst, def);
	});
	var $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
		def.pattern ?? (def.pattern = date$1);
		$ZodStringFormat.init(inst, def);
	});
	var $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
		def.pattern ?? (def.pattern = time$1(def));
		$ZodStringFormat.init(inst, def);
	});
	var $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
		def.pattern ?? (def.pattern = duration$1);
		$ZodStringFormat.init(inst, def);
	});
	var $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
		def.pattern ?? (def.pattern = ipv4);
		$ZodStringFormat.init(inst, def);
		inst._zod.bag.format = `ipv4`;
	});
	var $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
		def.pattern ?? (def.pattern = ipv6);
		$ZodStringFormat.init(inst, def);
		inst._zod.bag.format = `ipv6`;
		inst._zod.check = (payload) => {
			try {
				new URL(`http://[${payload.value}]`);
			} catch {
				payload.issues.push({
					code: "invalid_format",
					format: "ipv6",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
		};
	});
	var $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
		def.pattern ?? (def.pattern = cidrv4);
		$ZodStringFormat.init(inst, def);
	});
	var $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
		def.pattern ?? (def.pattern = cidrv6);
		$ZodStringFormat.init(inst, def);
		inst._zod.check = (payload) => {
			const parts = payload.value.split("/");
			try {
				if (parts.length !== 2) throw new Error();
				const [address, prefix] = parts;
				if (!prefix) throw new Error();
				const prefixNum = Number(prefix);
				if (`${prefixNum}` !== prefix) throw new Error();
				if (prefixNum < 0 || prefixNum > 128) throw new Error();
				new URL(`http://[${address}]`);
			} catch {
				payload.issues.push({
					code: "invalid_format",
					format: "cidrv6",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
		};
	});
	function isValidBase64(data) {
		if (data === "") return true;
		if (data.length % 4 !== 0) return false;
		try {
			atob(data);
			return true;
		} catch {
			return false;
		}
	}
	var $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
		def.pattern ?? (def.pattern = base64);
		$ZodStringFormat.init(inst, def);
		inst._zod.bag.contentEncoding = "base64";
		inst._zod.check = (payload) => {
			if (isValidBase64(payload.value)) return;
			payload.issues.push({
				code: "invalid_format",
				format: "base64",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		};
	});
	function isValidBase64URL(data) {
		if (!base64url.test(data)) return false;
		const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
		return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
	}
	var $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
		def.pattern ?? (def.pattern = base64url);
		$ZodStringFormat.init(inst, def);
		inst._zod.bag.contentEncoding = "base64url";
		inst._zod.check = (payload) => {
			if (isValidBase64URL(payload.value)) return;
			payload.issues.push({
				code: "invalid_format",
				format: "base64url",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		};
	});
	var $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
		def.pattern ?? (def.pattern = e164);
		$ZodStringFormat.init(inst, def);
	});
	function isValidJWT(token, algorithm = null) {
		try {
			const tokensParts = token.split(".");
			if (tokensParts.length !== 3) return false;
			const [header] = tokensParts;
			if (!header) return false;
			const parsedHeader = JSON.parse(atob(header));
			if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
			if (!parsedHeader.alg) return false;
			if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
			return true;
		} catch {
			return false;
		}
	}
	var $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
		$ZodStringFormat.init(inst, def);
		inst._zod.check = (payload) => {
			if (isValidJWT(payload.value, def.alg)) return;
			payload.issues.push({
				code: "invalid_format",
				format: "jwt",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		};
	});
	var $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
		$ZodType.init(inst, def);
		inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
		inst._zod.parse = (payload, _ctx) => {
			if (def.coerce) try {
				payload.value = Number(payload.value);
			} catch (_) {}
			const input = payload.value;
			if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
			const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
			payload.issues.push({
				expected: "number",
				code: "invalid_type",
				input,
				inst,
				...received ? { received } : {}
			});
			return payload;
		};
	});
	var $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
		$ZodCheckNumberFormat.init(inst, def);
		$ZodNumber.init(inst, def);
	});
	var $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
		$ZodType.init(inst, def);
		inst._zod.pattern = boolean$1;
		inst._zod.parse = (payload, _ctx) => {
			if (def.coerce) try {
				payload.value = Boolean(payload.value);
			} catch (_) {}
			const input = payload.value;
			if (typeof input === "boolean") return payload;
			payload.issues.push({
				expected: "boolean",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		};
	});
	var $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
		$ZodType.init(inst, def);
		inst._zod.parse = (payload) => payload;
	});
	var $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
		$ZodType.init(inst, def);
		inst._zod.parse = (payload, _ctx) => {
			payload.issues.push({
				expected: "never",
				code: "invalid_type",
				input: payload.value,
				inst
			});
			return payload;
		};
	});
	function handleArrayResult(result, final, index) {
		if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
		final.value[index] = result.value;
	}
	var $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
		$ZodType.init(inst, def);
		inst._zod.parse = (payload, ctx) => {
			const input = payload.value;
			if (!Array.isArray(input)) {
				payload.issues.push({
					expected: "array",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			}
			payload.value = Array(input.length);
			const proms = [];
			for (let i = 0; i < input.length; i++) {
				const item = input[i];
				const result = def.element._zod.run({
					value: item,
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
				else handleArrayResult(result, payload, i);
			}
			if (proms.length) return Promise.all(proms).then(() => payload);
			return payload;
		};
	});
	function handlePropertyResult(result, final, key, input, isOptionalOut) {
		if (result.issues.length) {
			if (isOptionalOut && !(key in input)) return;
			final.issues.push(...prefixIssues(key, result.issues));
		}
		if (result.value === void 0) {
			if (key in input) final.value[key] = void 0;
		} else final.value[key] = result.value;
	}
	function normalizeDef(def) {
		const keys = Object.keys(def.shape);
		for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
		const okeys = optionalKeys(def.shape);
		return {
			...def,
			keys,
			keySet: new Set(keys),
			numKeys: keys.length,
			optionalKeys: new Set(okeys)
		};
	}
	function handleCatchall(proms, input, payload, ctx, def, inst) {
		const unrecognized = [];
		const keySet = def.keySet;
		const _catchall = def.catchall._zod;
		const t = _catchall.def.type;
		const isOptionalOut = _catchall.optout === "optional";
		for (const key in input) {
			if (keySet.has(key)) continue;
			if (t === "never") {
				unrecognized.push(key);
				continue;
			}
			const r = _catchall.run({
				value: input[key],
				issues: []
			}, ctx);
			if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalOut)));
			else handlePropertyResult(r, payload, key, input, isOptionalOut);
		}
		if (unrecognized.length) payload.issues.push({
			code: "unrecognized_keys",
			keys: unrecognized,
			input,
			inst
		});
		if (!proms.length) return payload;
		return Promise.all(proms).then(() => {
			return payload;
		});
	}
	var $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
		$ZodType.init(inst, def);
		if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
			const sh = def.shape;
			Object.defineProperty(def, "shape", { get: () => {
				const newSh = { ...sh };
				Object.defineProperty(def, "shape", { value: newSh });
				return newSh;
			} });
		}
		const _normalized = cached(() => normalizeDef(def));
		defineLazy(inst._zod, "propValues", () => {
			const shape = def.shape;
			const propValues = {};
			for (const key in shape) {
				const field = shape[key]._zod;
				if (field.values) {
					propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
					for (const v of field.values) propValues[key].add(v);
				}
			}
			return propValues;
		});
		const isObject$1 = isObject;
		const catchall = def.catchall;
		let value;
		inst._zod.parse = (payload, ctx) => {
			value ?? (value = _normalized.value);
			const input = payload.value;
			if (!isObject$1(input)) {
				payload.issues.push({
					expected: "object",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			}
			payload.value = {};
			const proms = [];
			const shape = value.shape;
			for (const key of value.keys) {
				const el = shape[key];
				const isOptionalOut = el._zod.optout === "optional";
				const r = el._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalOut)));
				else handlePropertyResult(r, payload, key, input, isOptionalOut);
			}
			if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
			return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
		};
	});
	var $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
		$ZodObject.init(inst, def);
		const superParse = inst._zod.parse;
		const _normalized = cached(() => normalizeDef(def));
		const generateFastpass = (shape) => {
			const doc = new Doc([
				"shape",
				"payload",
				"ctx"
			]);
			const normalized = _normalized.value;
			const parseStr = (key) => {
				const k = esc(key);
				return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
			};
			doc.write(`const input = payload.value;`);
			const ids = Object.create(null);
			let counter = 0;
			for (const key of normalized.keys) ids[key] = `key_${counter++}`;
			doc.write(`const newResult = {};`);
			for (const key of normalized.keys) {
				const id = ids[key];
				const k = esc(key);
				const isOptionalOut = shape[key]?._zod?.optout === "optional";
				doc.write(`const ${id} = ${parseStr(key)};`);
				if (isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
				else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
			}
			doc.write(`payload.value = newResult;`);
			doc.write(`return payload;`);
			const fn = doc.compile();
			return (payload, ctx) => fn(shape, payload, ctx);
		};
		let fastpass;
		const isObject$2 = isObject;
		const jit = !globalConfig.jitless;
		const fastEnabled = jit && allowsEval.value;
		const catchall = def.catchall;
		let value;
		inst._zod.parse = (payload, ctx) => {
			value ?? (value = _normalized.value);
			const input = payload.value;
			if (!isObject$2(input)) {
				payload.issues.push({
					expected: "object",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			}
			if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
				if (!fastpass) fastpass = generateFastpass(def.shape);
				payload = fastpass(payload, ctx);
				if (!catchall) return payload;
				return handleCatchall([], input, payload, ctx, value, inst);
			}
			return superParse(payload, ctx);
		};
	});
	function handleUnionResults(results, final, inst, ctx) {
		for (const result of results) if (result.issues.length === 0) {
			final.value = result.value;
			return final;
		}
		const nonaborted = results.filter((r) => !aborted(r));
		if (nonaborted.length === 1) {
			final.value = nonaborted[0].value;
			return nonaborted[0];
		}
		final.issues.push({
			code: "invalid_union",
			input: final.value,
			inst,
			errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
		});
		return final;
	}
	var $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
		$ZodType.init(inst, def);
		defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
		defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
		defineLazy(inst._zod, "values", () => {
			if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
		});
		defineLazy(inst._zod, "pattern", () => {
			if (def.options.every((o) => o._zod.pattern)) {
				const patterns = def.options.map((o) => o._zod.pattern);
				return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
			}
		});
		const single = def.options.length === 1;
		const first = def.options[0]._zod.run;
		inst._zod.parse = (payload, ctx) => {
			if (single) return first(payload, ctx);
			let async = false;
			const results = [];
			for (const option of def.options) {
				const result = option._zod.run({
					value: payload.value,
					issues: []
				}, ctx);
				if (result instanceof Promise) {
					results.push(result);
					async = true;
				} else {
					if (result.issues.length === 0) return result;
					results.push(result);
				}
			}
			if (!async) return handleUnionResults(results, payload, inst, ctx);
			return Promise.all(results).then((results) => {
				return handleUnionResults(results, payload, inst, ctx);
			});
		};
	});
	var $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
		$ZodType.init(inst, def);
		inst._zod.parse = (payload, ctx) => {
			const input = payload.value;
			const left = def.left._zod.run({
				value: input,
				issues: []
			}, ctx);
			const right = def.right._zod.run({
				value: input,
				issues: []
			}, ctx);
			if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
				return handleIntersectionResults(payload, left, right);
			});
			return handleIntersectionResults(payload, left, right);
		};
	});
	function mergeValues(a, b) {
		if (a === b) return {
			valid: true,
			data: a
		};
		if (a instanceof Date && b instanceof Date && +a === +b) return {
			valid: true,
			data: a
		};
		if (isPlainObject(a) && isPlainObject(b)) {
			const bKeys = Object.keys(b);
			const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
			const newObj = {
				...a,
				...b
			};
			for (const key of sharedKeys) {
				const sharedValue = mergeValues(a[key], b[key]);
				if (!sharedValue.valid) return {
					valid: false,
					mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
				};
				newObj[key] = sharedValue.data;
			}
			return {
				valid: true,
				data: newObj
			};
		}
		if (Array.isArray(a) && Array.isArray(b)) {
			if (a.length !== b.length) return {
				valid: false,
				mergeErrorPath: []
			};
			const newArray = [];
			for (let index = 0; index < a.length; index++) {
				const itemA = a[index];
				const itemB = b[index];
				const sharedValue = mergeValues(itemA, itemB);
				if (!sharedValue.valid) return {
					valid: false,
					mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
				};
				newArray.push(sharedValue.data);
			}
			return {
				valid: true,
				data: newArray
			};
		}
		return {
			valid: false,
			mergeErrorPath: []
		};
	}
	function handleIntersectionResults(result, left, right) {
		const unrecKeys = /* @__PURE__ */ new Map();
		let unrecIssue;
		for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
			unrecIssue ?? (unrecIssue = iss);
			for (const k of iss.keys) {
				if (!unrecKeys.has(k)) unrecKeys.set(k, {});
				unrecKeys.get(k).l = true;
			}
		} else result.issues.push(iss);
		for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
			if (!unrecKeys.has(k)) unrecKeys.set(k, {});
			unrecKeys.get(k).r = true;
		}
		else result.issues.push(iss);
		const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
		if (bothKeys.length && unrecIssue) result.issues.push({
			...unrecIssue,
			keys: bothKeys
		});
		if (aborted(result)) return result;
		const merged = mergeValues(left.value, right.value);
		if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
		result.value = merged.data;
		return result;
	}
	var $ZodRecord = /*@__PURE__*/ $constructor("$ZodRecord", (inst, def) => {
		$ZodType.init(inst, def);
		inst._zod.parse = (payload, ctx) => {
			const input = payload.value;
			if (!isPlainObject(input)) {
				payload.issues.push({
					expected: "record",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			}
			const proms = [];
			const values = def.keyType._zod.values;
			if (values) {
				payload.value = {};
				const recordKeys = /* @__PURE__ */ new Set();
				for (const key of values) if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
					recordKeys.add(typeof key === "number" ? key.toString() : key);
					const result = def.valueType._zod.run({
						value: input[key],
						issues: []
					}, ctx);
					if (result instanceof Promise) proms.push(result.then((result) => {
						if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
						payload.value[key] = result.value;
					}));
					else {
						if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
						payload.value[key] = result.value;
					}
				}
				let unrecognized;
				for (const key in input) if (!recordKeys.has(key)) {
					unrecognized = unrecognized ?? [];
					unrecognized.push(key);
				}
				if (unrecognized && unrecognized.length > 0) payload.issues.push({
					code: "unrecognized_keys",
					input,
					inst,
					keys: unrecognized
				});
			} else {
				payload.value = {};
				for (const key of Reflect.ownKeys(input)) {
					if (key === "__proto__") continue;
					let keyResult = def.keyType._zod.run({
						value: key,
						issues: []
					}, ctx);
					if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
					if (typeof key === "string" && number$1.test(key) && keyResult.issues.length) {
						const retryResult = def.keyType._zod.run({
							value: Number(key),
							issues: []
						}, ctx);
						if (retryResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
						if (retryResult.issues.length === 0) keyResult = retryResult;
					}
					if (keyResult.issues.length) {
						if (def.mode === "loose") payload.value[key] = input[key];
						else payload.issues.push({
							code: "invalid_key",
							origin: "record",
							issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
							input: key,
							path: [key],
							inst
						});
						continue;
					}
					const result = def.valueType._zod.run({
						value: input[key],
						issues: []
					}, ctx);
					if (result instanceof Promise) proms.push(result.then((result) => {
						if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
						payload.value[keyResult.value] = result.value;
					}));
					else {
						if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
						payload.value[keyResult.value] = result.value;
					}
				}
			}
			if (proms.length) return Promise.all(proms).then(() => payload);
			return payload;
		};
	});
	var $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
		$ZodType.init(inst, def);
		const values = getEnumValues(def.entries);
		const valuesSet = new Set(values);
		inst._zod.values = valuesSet;
		inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
		inst._zod.parse = (payload, _ctx) => {
			const input = payload.value;
			if (valuesSet.has(input)) return payload;
			payload.issues.push({
				code: "invalid_value",
				values,
				input,
				inst
			});
			return payload;
		};
	});
	var $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
		$ZodType.init(inst, def);
		if (def.values.length === 0) throw new Error("Cannot create literal schema with no valid values");
		const values = new Set(def.values);
		inst._zod.values = values;
		inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
		inst._zod.parse = (payload, _ctx) => {
			const input = payload.value;
			if (values.has(input)) return payload;
			payload.issues.push({
				code: "invalid_value",
				values: def.values,
				input,
				inst
			});
			return payload;
		};
	});
	var $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
		$ZodType.init(inst, def);
		inst._zod.parse = (payload, ctx) => {
			if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
			const _out = def.transform(payload.value, payload);
			if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
				payload.value = output;
				return payload;
			});
			if (_out instanceof Promise) throw new $ZodAsyncError();
			payload.value = _out;
			return payload;
		};
	});
	function handleOptionalResult(result, input) {
		if (result.issues.length && input === void 0) return {
			issues: [],
			value: void 0
		};
		return result;
	}
	var $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
		$ZodType.init(inst, def);
		inst._zod.optin = "optional";
		inst._zod.optout = "optional";
		defineLazy(inst._zod, "values", () => {
			return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
		});
		defineLazy(inst._zod, "pattern", () => {
			const pattern = def.innerType._zod.pattern;
			return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
		});
		inst._zod.parse = (payload, ctx) => {
			if (def.innerType._zod.optin === "optional") {
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, payload.value));
				return handleOptionalResult(result, payload.value);
			}
			if (payload.value === void 0) return payload;
			return def.innerType._zod.run(payload, ctx);
		};
	});
	var $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
		$ZodOptional.init(inst, def);
		defineLazy(inst._zod, "values", () => def.innerType._zod.values);
		defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
		inst._zod.parse = (payload, ctx) => {
			return def.innerType._zod.run(payload, ctx);
		};
	});
	var $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
		$ZodType.init(inst, def);
		defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
		defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
		defineLazy(inst._zod, "pattern", () => {
			const pattern = def.innerType._zod.pattern;
			return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
		});
		defineLazy(inst._zod, "values", () => {
			return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
		});
		inst._zod.parse = (payload, ctx) => {
			if (payload.value === null) return payload;
			return def.innerType._zod.run(payload, ctx);
		};
	});
	var $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
		$ZodType.init(inst, def);
		inst._zod.optin = "optional";
		defineLazy(inst._zod, "values", () => def.innerType._zod.values);
		inst._zod.parse = (payload, ctx) => {
			if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
			if (payload.value === void 0) {
				payload.value = def.defaultValue;
				/**
				* $ZodDefault returns the default value immediately in forward direction.
				* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
				return payload;
			}
			const result = def.innerType._zod.run(payload, ctx);
			if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
			return handleDefaultResult(result, def);
		};
	});
	function handleDefaultResult(payload, def) {
		if (payload.value === void 0) payload.value = def.defaultValue;
		return payload;
	}
	var $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
		$ZodType.init(inst, def);
		inst._zod.optin = "optional";
		defineLazy(inst._zod, "values", () => def.innerType._zod.values);
		inst._zod.parse = (payload, ctx) => {
			if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
			if (payload.value === void 0) payload.value = def.defaultValue;
			return def.innerType._zod.run(payload, ctx);
		};
	});
	var $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
		$ZodType.init(inst, def);
		defineLazy(inst._zod, "values", () => {
			const v = def.innerType._zod.values;
			return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
		});
		inst._zod.parse = (payload, ctx) => {
			const result = def.innerType._zod.run(payload, ctx);
			if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
			return handleNonOptionalResult(result, inst);
		};
	});
	function handleNonOptionalResult(payload, inst) {
		if (!payload.issues.length && payload.value === void 0) payload.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: payload.value,
			inst
		});
		return payload;
	}
	var $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
		$ZodType.init(inst, def);
		defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
		defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
		defineLazy(inst._zod, "values", () => def.innerType._zod.values);
		inst._zod.parse = (payload, ctx) => {
			if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
			const result = def.innerType._zod.run(payload, ctx);
			if (result instanceof Promise) return result.then((result) => {
				payload.value = result.value;
				if (result.issues.length) {
					payload.value = def.catchValue({
						...payload,
						error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
						input: payload.value
					});
					payload.issues = [];
				}
				return payload;
			});
			payload.value = result.value;
			if (result.issues.length) {
				payload.value = def.catchValue({
					...payload,
					error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
					input: payload.value
				});
				payload.issues = [];
			}
			return payload;
		};
	});
	var $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
		$ZodType.init(inst, def);
		defineLazy(inst._zod, "values", () => def.in._zod.values);
		defineLazy(inst._zod, "optin", () => def.in._zod.optin);
		defineLazy(inst._zod, "optout", () => def.out._zod.optout);
		defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
		inst._zod.parse = (payload, ctx) => {
			if (ctx.direction === "backward") {
				const right = def.out._zod.run(payload, ctx);
				if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
				return handlePipeResult(right, def.in, ctx);
			}
			const left = def.in._zod.run(payload, ctx);
			if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
			return handlePipeResult(left, def.out, ctx);
		};
	});
	function handlePipeResult(left, next, ctx) {
		if (left.issues.length) {
			left.aborted = true;
			return left;
		}
		return next._zod.run({
			value: left.value,
			issues: left.issues
		}, ctx);
	}
	var $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
		$ZodType.init(inst, def);
		defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
		defineLazy(inst._zod, "values", () => def.innerType._zod.values);
		defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
		defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
		inst._zod.parse = (payload, ctx) => {
			if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
			const result = def.innerType._zod.run(payload, ctx);
			if (result instanceof Promise) return result.then(handleReadonlyResult);
			return handleReadonlyResult(result);
		};
	});
	function handleReadonlyResult(payload) {
		payload.value = Object.freeze(payload.value);
		return payload;
	}
	var $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
		$ZodCheck.init(inst, def);
		$ZodType.init(inst, def);
		inst._zod.parse = (payload, _) => {
			return payload;
		};
		inst._zod.check = (payload) => {
			const input = payload.value;
			const r = def.fn(input);
			if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
			handleRefineResult(r, payload, input, inst);
		};
	});
	function handleRefineResult(result, payload, input, inst) {
		if (!result) {
			const _iss = {
				code: "custom",
				input,
				inst,
				path: [...inst._zod.def.path ?? []],
				continue: !inst._zod.def.abort
			};
			if (inst._zod.def.params) _iss.params = inst._zod.def.params;
			payload.issues.push(issue(_iss));
		}
	}
	//#endregion
	//#region node_modules/zod/v4/core/registries.js
	var _a;
	var $ZodRegistry = class {
		constructor() {
			this._map = /* @__PURE__ */ new WeakMap();
			this._idmap = /* @__PURE__ */ new Map();
		}
		add(schema, ..._meta) {
			const meta = _meta[0];
			this._map.set(schema, meta);
			if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
			return this;
		}
		clear() {
			this._map = /* @__PURE__ */ new WeakMap();
			this._idmap = /* @__PURE__ */ new Map();
			return this;
		}
		remove(schema) {
			const meta = this._map.get(schema);
			if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
			this._map.delete(schema);
			return this;
		}
		get(schema) {
			const p = schema._zod.parent;
			if (p) {
				const pm = { ...this.get(p) ?? {} };
				delete pm.id;
				const f = {
					...pm,
					...this._map.get(schema)
				};
				return Object.keys(f).length ? f : void 0;
			}
			return this._map.get(schema);
		}
		has(schema) {
			return this._map.has(schema);
		}
	};
	function registry() {
		return new $ZodRegistry();
	}
	(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
	var globalRegistry = globalThis.__zod_globalRegistry;
	//#endregion
	//#region node_modules/zod/v4/core/api.js
	// @__NO_SIDE_EFFECTS__
	function _string(Class, params) {
		return new Class({
			type: "string",
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _email(Class, params) {
		return new Class({
			type: "string",
			format: "email",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _guid(Class, params) {
		return new Class({
			type: "string",
			format: "guid",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _uuid(Class, params) {
		return new Class({
			type: "string",
			format: "uuid",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _uuidv4(Class, params) {
		return new Class({
			type: "string",
			format: "uuid",
			check: "string_format",
			abort: false,
			version: "v4",
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _uuidv6(Class, params) {
		return new Class({
			type: "string",
			format: "uuid",
			check: "string_format",
			abort: false,
			version: "v6",
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _uuidv7(Class, params) {
		return new Class({
			type: "string",
			format: "uuid",
			check: "string_format",
			abort: false,
			version: "v7",
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _url(Class, params) {
		return new Class({
			type: "string",
			format: "url",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _emoji(Class, params) {
		return new Class({
			type: "string",
			format: "emoji",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _nanoid(Class, params) {
		return new Class({
			type: "string",
			format: "nanoid",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _cuid(Class, params) {
		return new Class({
			type: "string",
			format: "cuid",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _cuid2(Class, params) {
		return new Class({
			type: "string",
			format: "cuid2",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _ulid(Class, params) {
		return new Class({
			type: "string",
			format: "ulid",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _xid(Class, params) {
		return new Class({
			type: "string",
			format: "xid",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _ksuid(Class, params) {
		return new Class({
			type: "string",
			format: "ksuid",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _ipv4(Class, params) {
		return new Class({
			type: "string",
			format: "ipv4",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _ipv6(Class, params) {
		return new Class({
			type: "string",
			format: "ipv6",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _cidrv4(Class, params) {
		return new Class({
			type: "string",
			format: "cidrv4",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _cidrv6(Class, params) {
		return new Class({
			type: "string",
			format: "cidrv6",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _base64(Class, params) {
		return new Class({
			type: "string",
			format: "base64",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _base64url(Class, params) {
		return new Class({
			type: "string",
			format: "base64url",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _e164(Class, params) {
		return new Class({
			type: "string",
			format: "e164",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _jwt(Class, params) {
		return new Class({
			type: "string",
			format: "jwt",
			check: "string_format",
			abort: false,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _isoDateTime(Class, params) {
		return new Class({
			type: "string",
			format: "datetime",
			check: "string_format",
			offset: false,
			local: false,
			precision: null,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _isoDate(Class, params) {
		return new Class({
			type: "string",
			format: "date",
			check: "string_format",
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _isoTime(Class, params) {
		return new Class({
			type: "string",
			format: "time",
			check: "string_format",
			precision: null,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _isoDuration(Class, params) {
		return new Class({
			type: "string",
			format: "duration",
			check: "string_format",
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _number(Class, params) {
		return new Class({
			type: "number",
			checks: [],
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _int(Class, params) {
		return new Class({
			type: "number",
			check: "number_format",
			abort: false,
			format: "safeint",
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _boolean(Class, params) {
		return new Class({
			type: "boolean",
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _unknown(Class) {
		return new Class({ type: "unknown" });
	}
	// @__NO_SIDE_EFFECTS__
	function _never(Class, params) {
		return new Class({
			type: "never",
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _lt(value, params) {
		return new $ZodCheckLessThan({
			check: "less_than",
			...normalizeParams(params),
			value,
			inclusive: false
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _lte(value, params) {
		return new $ZodCheckLessThan({
			check: "less_than",
			...normalizeParams(params),
			value,
			inclusive: true
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _gt(value, params) {
		return new $ZodCheckGreaterThan({
			check: "greater_than",
			...normalizeParams(params),
			value,
			inclusive: false
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _gte(value, params) {
		return new $ZodCheckGreaterThan({
			check: "greater_than",
			...normalizeParams(params),
			value,
			inclusive: true
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _multipleOf(value, params) {
		return new $ZodCheckMultipleOf({
			check: "multiple_of",
			...normalizeParams(params),
			value
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _maxLength(maximum, params) {
		return new $ZodCheckMaxLength({
			check: "max_length",
			...normalizeParams(params),
			maximum
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _minLength(minimum, params) {
		return new $ZodCheckMinLength({
			check: "min_length",
			...normalizeParams(params),
			minimum
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _length(length, params) {
		return new $ZodCheckLengthEquals({
			check: "length_equals",
			...normalizeParams(params),
			length
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _regex(pattern, params) {
		return new $ZodCheckRegex({
			check: "string_format",
			format: "regex",
			...normalizeParams(params),
			pattern
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _lowercase(params) {
		return new $ZodCheckLowerCase({
			check: "string_format",
			format: "lowercase",
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _uppercase(params) {
		return new $ZodCheckUpperCase({
			check: "string_format",
			format: "uppercase",
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _includes(includes, params) {
		return new $ZodCheckIncludes({
			check: "string_format",
			format: "includes",
			...normalizeParams(params),
			includes
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _startsWith(prefix, params) {
		return new $ZodCheckStartsWith({
			check: "string_format",
			format: "starts_with",
			...normalizeParams(params),
			prefix
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _endsWith(suffix, params) {
		return new $ZodCheckEndsWith({
			check: "string_format",
			format: "ends_with",
			...normalizeParams(params),
			suffix
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _overwrite(tx) {
		return new $ZodCheckOverwrite({
			check: "overwrite",
			tx
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _normalize(form) {
		return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
	}
	// @__NO_SIDE_EFFECTS__
	function _trim() {
		return /* @__PURE__ */ _overwrite((input) => input.trim());
	}
	// @__NO_SIDE_EFFECTS__
	function _toLowerCase() {
		return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
	}
	// @__NO_SIDE_EFFECTS__
	function _toUpperCase() {
		return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
	}
	// @__NO_SIDE_EFFECTS__
	function _slugify() {
		return /* @__PURE__ */ _overwrite((input) => slugify(input));
	}
	// @__NO_SIDE_EFFECTS__
	function _array(Class, element, params) {
		return new Class({
			type: "array",
			element,
			...normalizeParams(params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _refine(Class, fn, _params) {
		return new Class({
			type: "custom",
			check: "custom",
			fn,
			...normalizeParams(_params)
		});
	}
	// @__NO_SIDE_EFFECTS__
	function _superRefine(fn) {
		const ch = /* @__PURE__ */ _check((payload) => {
			payload.addIssue = (issue$2) => {
				if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
				else {
					const _issue = issue$2;
					if (_issue.fatal) _issue.continue = false;
					_issue.code ?? (_issue.code = "custom");
					_issue.input ?? (_issue.input = payload.value);
					_issue.inst ?? (_issue.inst = ch);
					_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
					payload.issues.push(issue(_issue));
				}
			};
			return fn(payload.value, payload);
		});
		return ch;
	}
	// @__NO_SIDE_EFFECTS__
	function _check(fn, params) {
		const ch = new $ZodCheck({
			check: "custom",
			...normalizeParams(params)
		});
		ch._zod.check = fn;
		return ch;
	}
	//#endregion
	//#region node_modules/zod/v4/core/to-json-schema.js
	function initializeContext(params) {
		let target = params?.target ?? "draft-2020-12";
		if (target === "draft-4") target = "draft-04";
		if (target === "draft-7") target = "draft-07";
		return {
			processors: params.processors ?? {},
			metadataRegistry: params?.metadata ?? globalRegistry,
			target,
			unrepresentable: params?.unrepresentable ?? "throw",
			override: params?.override ?? (() => {}),
			io: params?.io ?? "output",
			counter: 0,
			seen: /* @__PURE__ */ new Map(),
			cycles: params?.cycles ?? "ref",
			reused: params?.reused ?? "inline",
			external: params?.external ?? void 0
		};
	}
	function process(schema, ctx, _params = {
		path: [],
		schemaPath: []
	}) {
		var _a;
		const def = schema._zod.def;
		const seen = ctx.seen.get(schema);
		if (seen) {
			seen.count++;
			if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
			return seen.schema;
		}
		const result = {
			schema: {},
			count: 1,
			cycle: void 0,
			path: _params.path
		};
		ctx.seen.set(schema, result);
		const overrideSchema = schema._zod.toJSONSchema?.();
		if (overrideSchema) result.schema = overrideSchema;
		else {
			const params = {
				..._params,
				schemaPath: [..._params.schemaPath, schema],
				path: _params.path
			};
			if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
			else {
				const _json = result.schema;
				const processor = ctx.processors[def.type];
				if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
				processor(schema, ctx, _json, params);
			}
			const parent = schema._zod.parent;
			if (parent) {
				if (!result.ref) result.ref = parent;
				process(parent, ctx, params);
				ctx.seen.get(parent).isParent = true;
			}
		}
		const meta = ctx.metadataRegistry.get(schema);
		if (meta) Object.assign(result.schema, meta);
		if (ctx.io === "input" && isTransforming(schema)) {
			delete result.schema.examples;
			delete result.schema.default;
		}
		if (ctx.io === "input" && result.schema._prefault) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
		delete result.schema._prefault;
		return ctx.seen.get(schema).schema;
	}
	function extractDefs(ctx, schema) {
		const root = ctx.seen.get(schema);
		if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
		const idToSchema = /* @__PURE__ */ new Map();
		for (const entry of ctx.seen.entries()) {
			const id = ctx.metadataRegistry.get(entry[0])?.id;
			if (id) {
				const existing = idToSchema.get(id);
				if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
				idToSchema.set(id, entry[0]);
			}
		}
		const makeURI = (entry) => {
			const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
			if (ctx.external) {
				const externalId = ctx.external.registry.get(entry[0])?.id;
				const uriGenerator = ctx.external.uri ?? ((id) => id);
				if (externalId) return { ref: uriGenerator(externalId) };
				const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
				entry[1].defId = id;
				return {
					defId: id,
					ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
				};
			}
			if (entry[1] === root) return { ref: "#" };
			const defUriPrefix = `#/${defsSegment}/`;
			const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
			return {
				defId,
				ref: defUriPrefix + defId
			};
		};
		const extractToDef = (entry) => {
			if (entry[1].schema.$ref) return;
			const seen = entry[1];
			const { ref, defId } = makeURI(entry);
			seen.def = { ...seen.schema };
			if (defId) seen.defId = defId;
			const schema = seen.schema;
			for (const key in schema) delete schema[key];
			schema.$ref = ref;
		};
		if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
			const seen = entry[1];
			if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
		}
		for (const entry of ctx.seen.entries()) {
			const seen = entry[1];
			if (schema === entry[0]) {
				extractToDef(entry);
				continue;
			}
			if (ctx.external) {
				const ext = ctx.external.registry.get(entry[0])?.id;
				if (schema !== entry[0] && ext) {
					extractToDef(entry);
					continue;
				}
			}
			if (ctx.metadataRegistry.get(entry[0])?.id) {
				extractToDef(entry);
				continue;
			}
			if (seen.cycle) {
				extractToDef(entry);
				continue;
			}
			if (seen.count > 1) {
				if (ctx.reused === "ref") {
					extractToDef(entry);
					continue;
				}
			}
		}
	}
	function finalize(ctx, schema) {
		const root = ctx.seen.get(schema);
		if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
		const flattenRef = (zodSchema) => {
			const seen = ctx.seen.get(zodSchema);
			if (seen.ref === null) return;
			const schema = seen.def ?? seen.schema;
			const _cached = { ...schema };
			const ref = seen.ref;
			seen.ref = null;
			if (ref) {
				flattenRef(ref);
				const refSeen = ctx.seen.get(ref);
				const refSchema = refSeen.schema;
				if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
					schema.allOf = schema.allOf ?? [];
					schema.allOf.push(refSchema);
				} else Object.assign(schema, refSchema);
				Object.assign(schema, _cached);
				if (zodSchema._zod.parent === ref) for (const key in schema) {
					if (key === "$ref" || key === "allOf") continue;
					if (!(key in _cached)) delete schema[key];
				}
				if (refSchema.$ref && refSeen.def) for (const key in schema) {
					if (key === "$ref" || key === "allOf") continue;
					if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
				}
			}
			const parent = zodSchema._zod.parent;
			if (parent && parent !== ref) {
				flattenRef(parent);
				const parentSeen = ctx.seen.get(parent);
				if (parentSeen?.schema.$ref) {
					schema.$ref = parentSeen.schema.$ref;
					if (parentSeen.def) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
					}
				}
			}
			ctx.override({
				zodSchema,
				jsonSchema: schema,
				path: seen.path ?? []
			});
		};
		for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
		const result = {};
		if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
		else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
		else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
		else if (ctx.target === "openapi-3.0") {}
		if (ctx.external?.uri) {
			const id = ctx.external.registry.get(schema)?.id;
			if (!id) throw new Error("Schema is missing an `id` property");
			result.$id = ctx.external.uri(id);
		}
		Object.assign(result, root.def ?? root.schema);
		const defs = ctx.external?.defs ?? {};
		for (const entry of ctx.seen.entries()) {
			const seen = entry[1];
			if (seen.def && seen.defId) defs[seen.defId] = seen.def;
		}
		if (ctx.external) {} else if (Object.keys(defs).length > 0) if (ctx.target === "draft-2020-12") result.$defs = defs;
		else result.definitions = defs;
		try {
			const finalized = JSON.parse(JSON.stringify(result));
			Object.defineProperty(finalized, "~standard", {
				value: {
					...schema["~standard"],
					jsonSchema: {
						input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
						output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
					}
				},
				enumerable: false,
				writable: false
			});
			return finalized;
		} catch (_err) {
			throw new Error("Error converting schema to JSON.");
		}
	}
	function isTransforming(_schema, _ctx) {
		const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
		if (ctx.seen.has(_schema)) return false;
		ctx.seen.add(_schema);
		const def = _schema._zod.def;
		if (def.type === "transform") return true;
		if (def.type === "array") return isTransforming(def.element, ctx);
		if (def.type === "set") return isTransforming(def.valueType, ctx);
		if (def.type === "lazy") return isTransforming(def.getter(), ctx);
		if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
		if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
		if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
		if (def.type === "pipe") return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
		if (def.type === "object") {
			for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
			return false;
		}
		if (def.type === "union") {
			for (const option of def.options) if (isTransforming(option, ctx)) return true;
			return false;
		}
		if (def.type === "tuple") {
			for (const item of def.items) if (isTransforming(item, ctx)) return true;
			if (def.rest && isTransforming(def.rest, ctx)) return true;
			return false;
		}
		return false;
	}
	/**
	* Creates a toJSONSchema method for a schema instance.
	* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
	*/
	var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
		const ctx = initializeContext({
			...params,
			processors
		});
		process(schema, ctx);
		extractDefs(ctx, schema);
		return finalize(ctx, schema);
	};
	var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
		const { libraryOptions, target } = params ?? {};
		const ctx = initializeContext({
			...libraryOptions ?? {},
			target,
			io,
			processors
		});
		process(schema, ctx);
		extractDefs(ctx, schema);
		return finalize(ctx, schema);
	};
	//#endregion
	//#region node_modules/zod/v4/core/json-schema-processors.js
	var formatMap = {
		guid: "uuid",
		url: "uri",
		datetime: "date-time",
		json_string: "json-string",
		regex: ""
	};
	var stringProcessor = (schema, ctx, _json, _params) => {
		const json = _json;
		json.type = "string";
		const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
		if (typeof minimum === "number") json.minLength = minimum;
		if (typeof maximum === "number") json.maxLength = maximum;
		if (format) {
			json.format = formatMap[format] ?? format;
			if (json.format === "") delete json.format;
			if (format === "time") delete json.format;
		}
		if (contentEncoding) json.contentEncoding = contentEncoding;
		if (patterns && patterns.size > 0) {
			const regexes = [...patterns];
			if (regexes.length === 1) json.pattern = regexes[0].source;
			else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
				...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
				pattern: regex.source
			}))];
		}
	};
	var numberProcessor = (schema, ctx, _json, _params) => {
		const json = _json;
		const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
		if (typeof format === "string" && format.includes("int")) json.type = "integer";
		else json.type = "number";
		if (typeof exclusiveMinimum === "number") if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
			json.minimum = exclusiveMinimum;
			json.exclusiveMinimum = true;
		} else json.exclusiveMinimum = exclusiveMinimum;
		if (typeof minimum === "number") {
			json.minimum = minimum;
			if (typeof exclusiveMinimum === "number" && ctx.target !== "draft-04") if (exclusiveMinimum >= minimum) delete json.minimum;
			else delete json.exclusiveMinimum;
		}
		if (typeof exclusiveMaximum === "number") if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
			json.maximum = exclusiveMaximum;
			json.exclusiveMaximum = true;
		} else json.exclusiveMaximum = exclusiveMaximum;
		if (typeof maximum === "number") {
			json.maximum = maximum;
			if (typeof exclusiveMaximum === "number" && ctx.target !== "draft-04") if (exclusiveMaximum <= maximum) delete json.maximum;
			else delete json.exclusiveMaximum;
		}
		if (typeof multipleOf === "number") json.multipleOf = multipleOf;
	};
	var booleanProcessor = (_schema, _ctx, json, _params) => {
		json.type = "boolean";
	};
	var neverProcessor = (_schema, _ctx, json, _params) => {
		json.not = {};
	};
	var enumProcessor = (schema, _ctx, json, _params) => {
		const def = schema._zod.def;
		const values = getEnumValues(def.entries);
		if (values.every((v) => typeof v === "number")) json.type = "number";
		if (values.every((v) => typeof v === "string")) json.type = "string";
		json.enum = values;
	};
	var literalProcessor = (schema, ctx, json, _params) => {
		const def = schema._zod.def;
		const vals = [];
		for (const val of def.values) if (val === void 0) {
			if (ctx.unrepresentable === "throw") throw new Error("Literal `undefined` cannot be represented in JSON Schema");
		} else if (typeof val === "bigint") if (ctx.unrepresentable === "throw") throw new Error("BigInt literals cannot be represented in JSON Schema");
		else vals.push(Number(val));
		else vals.push(val);
		if (vals.length === 0) {} else if (vals.length === 1) {
			const val = vals[0];
			json.type = val === null ? "null" : typeof val;
			if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
			else json.const = val;
		} else {
			if (vals.every((v) => typeof v === "number")) json.type = "number";
			if (vals.every((v) => typeof v === "string")) json.type = "string";
			if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
			if (vals.every((v) => v === null)) json.type = "null";
			json.enum = vals;
		}
	};
	var customProcessor = (_schema, ctx, _json, _params) => {
		if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
	};
	var transformProcessor = (_schema, ctx, _json, _params) => {
		if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
	};
	var arrayProcessor = (schema, ctx, _json, params) => {
		const json = _json;
		const def = schema._zod.def;
		const { minimum, maximum } = schema._zod.bag;
		if (typeof minimum === "number") json.minItems = minimum;
		if (typeof maximum === "number") json.maxItems = maximum;
		json.type = "array";
		json.items = process(def.element, ctx, {
			...params,
			path: [...params.path, "items"]
		});
	};
	var objectProcessor = (schema, ctx, _json, params) => {
		const json = _json;
		const def = schema._zod.def;
		json.type = "object";
		json.properties = {};
		const shape = def.shape;
		for (const key in shape) json.properties[key] = process(shape[key], ctx, {
			...params,
			path: [
				...params.path,
				"properties",
				key
			]
		});
		const allKeys = new Set(Object.keys(shape));
		const requiredKeys = new Set([...allKeys].filter((key) => {
			const v = def.shape[key]._zod;
			if (ctx.io === "input") return v.optin === void 0;
			else return v.optout === void 0;
		}));
		if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
		if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
		else if (!def.catchall) {
			if (ctx.io === "output") json.additionalProperties = false;
		} else if (def.catchall) json.additionalProperties = process(def.catchall, ctx, {
			...params,
			path: [...params.path, "additionalProperties"]
		});
	};
	var unionProcessor = (schema, ctx, json, params) => {
		const def = schema._zod.def;
		const isExclusive = def.inclusive === false;
		const options = def.options.map((x, i) => process(x, ctx, {
			...params,
			path: [
				...params.path,
				isExclusive ? "oneOf" : "anyOf",
				i
			]
		}));
		if (isExclusive) json.oneOf = options;
		else json.anyOf = options;
	};
	var intersectionProcessor = (schema, ctx, json, params) => {
		const def = schema._zod.def;
		const a = process(def.left, ctx, {
			...params,
			path: [
				...params.path,
				"allOf",
				0
			]
		});
		const b = process(def.right, ctx, {
			...params,
			path: [
				...params.path,
				"allOf",
				1
			]
		});
		const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
		json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
	};
	var recordProcessor = (schema, ctx, _json, params) => {
		const json = _json;
		const def = schema._zod.def;
		json.type = "object";
		const keyType = def.keyType;
		const patterns = keyType._zod.bag?.patterns;
		if (def.mode === "loose" && patterns && patterns.size > 0) {
			const valueSchema = process(def.valueType, ctx, {
				...params,
				path: [
					...params.path,
					"patternProperties",
					"*"
				]
			});
			json.patternProperties = {};
			for (const pattern of patterns) json.patternProperties[pattern.source] = valueSchema;
		} else {
			if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") json.propertyNames = process(def.keyType, ctx, {
				...params,
				path: [...params.path, "propertyNames"]
			});
			json.additionalProperties = process(def.valueType, ctx, {
				...params,
				path: [...params.path, "additionalProperties"]
			});
		}
		const keyValues = keyType._zod.values;
		if (keyValues) {
			const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
			if (validKeyValues.length > 0) json.required = validKeyValues;
		}
	};
	var nullableProcessor = (schema, ctx, json, params) => {
		const def = schema._zod.def;
		const inner = process(def.innerType, ctx, params);
		const seen = ctx.seen.get(schema);
		if (ctx.target === "openapi-3.0") {
			seen.ref = def.innerType;
			json.nullable = true;
		} else json.anyOf = [inner, { type: "null" }];
	};
	var nonoptionalProcessor = (schema, ctx, _json, params) => {
		const def = schema._zod.def;
		process(def.innerType, ctx, params);
		const seen = ctx.seen.get(schema);
		seen.ref = def.innerType;
	};
	var defaultProcessor = (schema, ctx, json, params) => {
		const def = schema._zod.def;
		process(def.innerType, ctx, params);
		const seen = ctx.seen.get(schema);
		seen.ref = def.innerType;
		json.default = JSON.parse(JSON.stringify(def.defaultValue));
	};
	var prefaultProcessor = (schema, ctx, json, params) => {
		const def = schema._zod.def;
		process(def.innerType, ctx, params);
		const seen = ctx.seen.get(schema);
		seen.ref = def.innerType;
		if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
	};
	var catchProcessor = (schema, ctx, json, params) => {
		const def = schema._zod.def;
		process(def.innerType, ctx, params);
		const seen = ctx.seen.get(schema);
		seen.ref = def.innerType;
		let catchValue;
		try {
			catchValue = def.catchValue(void 0);
		} catch {
			throw new Error("Dynamic catch values are not supported in JSON Schema");
		}
		json.default = catchValue;
	};
	var pipeProcessor = (schema, ctx, _json, params) => {
		const def = schema._zod.def;
		const innerType = ctx.io === "input" ? def.in._zod.def.type === "transform" ? def.out : def.in : def.out;
		process(innerType, ctx, params);
		const seen = ctx.seen.get(schema);
		seen.ref = innerType;
	};
	var readonlyProcessor = (schema, ctx, json, params) => {
		const def = schema._zod.def;
		process(def.innerType, ctx, params);
		const seen = ctx.seen.get(schema);
		seen.ref = def.innerType;
		json.readOnly = true;
	};
	var optionalProcessor = (schema, ctx, _json, params) => {
		const def = schema._zod.def;
		process(def.innerType, ctx, params);
		const seen = ctx.seen.get(schema);
		seen.ref = def.innerType;
	};
	//#endregion
	//#region node_modules/zod/v4/classic/iso.js
	var ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
		$ZodISODateTime.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	function datetime(params) {
		return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
	}
	var ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
		$ZodISODate.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	function date(params) {
		return /* @__PURE__ */ _isoDate(ZodISODate, params);
	}
	var ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
		$ZodISOTime.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	function time(params) {
		return /* @__PURE__ */ _isoTime(ZodISOTime, params);
	}
	var ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
		$ZodISODuration.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	function duration(params) {
		return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
	}
	//#endregion
	//#region node_modules/zod/v4/classic/errors.js
	var initializer = (inst, issues) => {
		$ZodError.init(inst, issues);
		inst.name = "ZodError";
		Object.defineProperties(inst, {
			format: { value: (mapper) => formatError(inst, mapper) },
			flatten: { value: (mapper) => flattenError(inst, mapper) },
			addIssue: { value: (issue) => {
				inst.issues.push(issue);
				inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
			} },
			addIssues: { value: (issues) => {
				inst.issues.push(...issues);
				inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
			} },
			isEmpty: { get() {
				return inst.issues.length === 0;
			} }
		});
	};
	$constructor("ZodError", initializer);
	var ZodRealError = $constructor("ZodError", initializer, { Parent: Error });
	//#endregion
	//#region node_modules/zod/v4/classic/parse.js
	var parse = /* @__PURE__ */ _parse(ZodRealError);
	var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
	var safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
	var safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
	var encode = /* @__PURE__ */ _encode(ZodRealError);
	var decode = /* @__PURE__ */ _decode(ZodRealError);
	var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
	var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
	var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
	var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
	var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
	var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
	//#endregion
	//#region node_modules/zod/v4/classic/schemas.js
	var ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
		$ZodType.init(inst, def);
		Object.assign(inst["~standard"], { jsonSchema: {
			input: createStandardJSONSchemaMethod(inst, "input"),
			output: createStandardJSONSchemaMethod(inst, "output")
		} });
		inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
		inst.def = def;
		inst.type = def.type;
		Object.defineProperty(inst, "_def", { value: def });
		inst.check = (...checks) => {
			return inst.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...checks.map((ch) => typeof ch === "function" ? { _zod: {
				check: ch,
				def: { check: "custom" },
				onattach: []
			} } : ch)] }), { parent: true });
		};
		inst.with = inst.check;
		inst.clone = (def, params) => clone(inst, def, params);
		inst.brand = () => inst;
		inst.register = ((reg, meta) => {
			reg.add(inst, meta);
			return inst;
		});
		inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
		inst.safeParse = (data, params) => safeParse(inst, data, params);
		inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
		inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
		inst.spa = inst.safeParseAsync;
		inst.encode = (data, params) => encode(inst, data, params);
		inst.decode = (data, params) => decode(inst, data, params);
		inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
		inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
		inst.safeEncode = (data, params) => safeEncode(inst, data, params);
		inst.safeDecode = (data, params) => safeDecode(inst, data, params);
		inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
		inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
		inst.refine = (check, params) => inst.check(refine(check, params));
		inst.superRefine = (refinement) => inst.check(superRefine(refinement));
		inst.overwrite = (fn) => inst.check(/* @__PURE__ */ _overwrite(fn));
		inst.optional = () => optional(inst);
		inst.exactOptional = () => exactOptional(inst);
		inst.nullable = () => nullable(inst);
		inst.nullish = () => optional(nullable(inst));
		inst.nonoptional = (params) => nonoptional(inst, params);
		inst.array = () => array(inst);
		inst.or = (arg) => union([inst, arg]);
		inst.and = (arg) => intersection(inst, arg);
		inst.transform = (tx) => pipe(inst, transform(tx));
		inst.default = (def) => _default(inst, def);
		inst.prefault = (def) => prefault(inst, def);
		inst.catch = (params) => _catch(inst, params);
		inst.pipe = (target) => pipe(inst, target);
		inst.readonly = () => readonly(inst);
		inst.describe = (description) => {
			const cl = inst.clone();
			globalRegistry.add(cl, { description });
			return cl;
		};
		Object.defineProperty(inst, "description", {
			get() {
				return globalRegistry.get(inst)?.description;
			},
			configurable: true
		});
		inst.meta = (...args) => {
			if (args.length === 0) return globalRegistry.get(inst);
			const cl = inst.clone();
			globalRegistry.add(cl, args[0]);
			return cl;
		};
		inst.isOptional = () => inst.safeParse(void 0).success;
		inst.isNullable = () => inst.safeParse(null).success;
		inst.apply = (fn) => fn(inst);
		return inst;
	});
	/** @internal */
	var _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
		$ZodString.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
		const bag = inst._zod.bag;
		inst.format = bag.format ?? null;
		inst.minLength = bag.minimum ?? null;
		inst.maxLength = bag.maximum ?? null;
		inst.regex = (...args) => inst.check(/* @__PURE__ */ _regex(...args));
		inst.includes = (...args) => inst.check(/* @__PURE__ */ _includes(...args));
		inst.startsWith = (...args) => inst.check(/* @__PURE__ */ _startsWith(...args));
		inst.endsWith = (...args) => inst.check(/* @__PURE__ */ _endsWith(...args));
		inst.min = (...args) => inst.check(/* @__PURE__ */ _minLength(...args));
		inst.max = (...args) => inst.check(/* @__PURE__ */ _maxLength(...args));
		inst.length = (...args) => inst.check(/* @__PURE__ */ _length(...args));
		inst.nonempty = (...args) => inst.check(/* @__PURE__ */ _minLength(1, ...args));
		inst.lowercase = (params) => inst.check(/* @__PURE__ */ _lowercase(params));
		inst.uppercase = (params) => inst.check(/* @__PURE__ */ _uppercase(params));
		inst.trim = () => inst.check(/* @__PURE__ */ _trim());
		inst.normalize = (...args) => inst.check(/* @__PURE__ */ _normalize(...args));
		inst.toLowerCase = () => inst.check(/* @__PURE__ */ _toLowerCase());
		inst.toUpperCase = () => inst.check(/* @__PURE__ */ _toUpperCase());
		inst.slugify = () => inst.check(/* @__PURE__ */ _slugify());
	});
	var ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
		$ZodString.init(inst, def);
		_ZodString.init(inst, def);
		inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
		inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
		inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
		inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
		inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
		inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
		inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
		inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
		inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
		inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
		inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
		inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
		inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
		inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
		inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
		inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
		inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
		inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
		inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
		inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
		inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
		inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
		inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
		inst.datetime = (params) => inst.check(datetime(params));
		inst.date = (params) => inst.check(date(params));
		inst.time = (params) => inst.check(time(params));
		inst.duration = (params) => inst.check(duration(params));
	});
	function string(params) {
		return /* @__PURE__ */ _string(ZodString, params);
	}
	var ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
		$ZodStringFormat.init(inst, def);
		_ZodString.init(inst, def);
	});
	var ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
		$ZodEmail.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
		$ZodGUID.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
		$ZodUUID.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
		$ZodURL.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
		$ZodEmoji.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
		$ZodNanoID.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
		$ZodCUID.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
		$ZodCUID2.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
		$ZodULID.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
		$ZodXID.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
		$ZodKSUID.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
		$ZodIPv4.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
		$ZodIPv6.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
		$ZodCIDRv4.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
		$ZodCIDRv6.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
		$ZodBase64.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
		$ZodBase64URL.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
		$ZodE164.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
		$ZodJWT.init(inst, def);
		ZodStringFormat.init(inst, def);
	});
	var ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
		$ZodNumber.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
		inst.gt = (value, params) => inst.check(/* @__PURE__ */ _gt(value, params));
		inst.gte = (value, params) => inst.check(/* @__PURE__ */ _gte(value, params));
		inst.min = (value, params) => inst.check(/* @__PURE__ */ _gte(value, params));
		inst.lt = (value, params) => inst.check(/* @__PURE__ */ _lt(value, params));
		inst.lte = (value, params) => inst.check(/* @__PURE__ */ _lte(value, params));
		inst.max = (value, params) => inst.check(/* @__PURE__ */ _lte(value, params));
		inst.int = (params) => inst.check(int(params));
		inst.safe = (params) => inst.check(int(params));
		inst.positive = (params) => inst.check(/* @__PURE__ */ _gt(0, params));
		inst.nonnegative = (params) => inst.check(/* @__PURE__ */ _gte(0, params));
		inst.negative = (params) => inst.check(/* @__PURE__ */ _lt(0, params));
		inst.nonpositive = (params) => inst.check(/* @__PURE__ */ _lte(0, params));
		inst.multipleOf = (value, params) => inst.check(/* @__PURE__ */ _multipleOf(value, params));
		inst.step = (value, params) => inst.check(/* @__PURE__ */ _multipleOf(value, params));
		inst.finite = () => inst;
		const bag = inst._zod.bag;
		inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
		inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
		inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? .5);
		inst.isFinite = true;
		inst.format = bag.format ?? null;
	});
	function number(params) {
		return /* @__PURE__ */ _number(ZodNumber, params);
	}
	var ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
		$ZodNumberFormat.init(inst, def);
		ZodNumber.init(inst, def);
	});
	function int(params) {
		return /* @__PURE__ */ _int(ZodNumberFormat, params);
	}
	var ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
		$ZodBoolean.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
	});
	function boolean(params) {
		return /* @__PURE__ */ _boolean(ZodBoolean, params);
	}
	var ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
		$ZodUnknown.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => void 0;
	});
	function unknown() {
		return /* @__PURE__ */ _unknown(ZodUnknown);
	}
	var ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
		$ZodNever.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
	});
	function never(params) {
		return /* @__PURE__ */ _never(ZodNever, params);
	}
	var ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
		$ZodArray.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
		inst.element = def.element;
		inst.min = (minLength, params) => inst.check(/* @__PURE__ */ _minLength(minLength, params));
		inst.nonempty = (params) => inst.check(/* @__PURE__ */ _minLength(1, params));
		inst.max = (maxLength, params) => inst.check(/* @__PURE__ */ _maxLength(maxLength, params));
		inst.length = (len, params) => inst.check(/* @__PURE__ */ _length(len, params));
		inst.unwrap = () => inst.element;
	});
	function array(element, params) {
		return /* @__PURE__ */ _array(ZodArray, element, params);
	}
	var ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
		$ZodObjectJIT.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
		defineLazy(inst, "shape", () => {
			return def.shape;
		});
		inst.keyof = () => _enum(Object.keys(inst._zod.def.shape));
		inst.catchall = (catchall) => inst.clone({
			...inst._zod.def,
			catchall
		});
		inst.passthrough = () => inst.clone({
			...inst._zod.def,
			catchall: unknown()
		});
		inst.loose = () => inst.clone({
			...inst._zod.def,
			catchall: unknown()
		});
		inst.strict = () => inst.clone({
			...inst._zod.def,
			catchall: never()
		});
		inst.strip = () => inst.clone({
			...inst._zod.def,
			catchall: void 0
		});
		inst.extend = (incoming) => {
			return extend(inst, incoming);
		};
		inst.safeExtend = (incoming) => {
			return safeExtend(inst, incoming);
		};
		inst.merge = (other) => merge(inst, other);
		inst.pick = (mask) => pick(inst, mask);
		inst.omit = (mask) => omit(inst, mask);
		inst.partial = (...args) => partial(ZodOptional, inst, args[0]);
		inst.required = (...args) => required(ZodNonOptional, inst, args[0]);
	});
	function strictObject(shape, params) {
		return new ZodObject({
			type: "object",
			shape,
			catchall: never(),
			...normalizeParams(params)
		});
	}
	var ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
		$ZodUnion.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
		inst.options = def.options;
	});
	function union(options, params) {
		return new ZodUnion({
			type: "union",
			options,
			...normalizeParams(params)
		});
	}
	var ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
		$ZodIntersection.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
	});
	function intersection(left, right) {
		return new ZodIntersection({
			type: "intersection",
			left,
			right
		});
	}
	var ZodRecord = /*@__PURE__*/ $constructor("ZodRecord", (inst, def) => {
		$ZodRecord.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
		inst.keyType = def.keyType;
		inst.valueType = def.valueType;
	});
	function record(keyType, valueType, params) {
		return new ZodRecord({
			type: "record",
			keyType,
			valueType,
			...normalizeParams(params)
		});
	}
	var ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
		$ZodEnum.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
		inst.enum = def.entries;
		inst.options = Object.values(def.entries);
		const keys = new Set(Object.keys(def.entries));
		inst.extract = (values, params) => {
			const newEntries = {};
			for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
			else throw new Error(`Key ${value} not found in enum`);
			return new ZodEnum({
				...def,
				checks: [],
				...normalizeParams(params),
				entries: newEntries
			});
		};
		inst.exclude = (values, params) => {
			const newEntries = { ...def.entries };
			for (const value of values) if (keys.has(value)) delete newEntries[value];
			else throw new Error(`Key ${value} not found in enum`);
			return new ZodEnum({
				...def,
				checks: [],
				...normalizeParams(params),
				entries: newEntries
			});
		};
	});
	function _enum(values, params) {
		return new ZodEnum({
			type: "enum",
			entries: Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values,
			...normalizeParams(params)
		});
	}
	var ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
		$ZodLiteral.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
		inst.values = new Set(def.values);
		Object.defineProperty(inst, "value", { get() {
			if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
			return def.values[0];
		} });
	});
	function literal(value, params) {
		return new ZodLiteral({
			type: "literal",
			values: Array.isArray(value) ? value : [value],
			...normalizeParams(params)
		});
	}
	var ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
		$ZodTransform.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
		inst._zod.parse = (payload, _ctx) => {
			if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
			payload.addIssue = (issue$1) => {
				if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
				else {
					const _issue = issue$1;
					if (_issue.fatal) _issue.continue = false;
					_issue.code ?? (_issue.code = "custom");
					_issue.input ?? (_issue.input = payload.value);
					_issue.inst ?? (_issue.inst = inst);
					payload.issues.push(issue(_issue));
				}
			};
			const output = def.transform(payload.value, payload);
			if (output instanceof Promise) return output.then((output) => {
				payload.value = output;
				return payload;
			});
			payload.value = output;
			return payload;
		};
	});
	function transform(fn) {
		return new ZodTransform({
			type: "transform",
			transform: fn
		});
	}
	var ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
		$ZodOptional.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
		inst.unwrap = () => inst._zod.def.innerType;
	});
	function optional(innerType) {
		return new ZodOptional({
			type: "optional",
			innerType
		});
	}
	var ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
		$ZodExactOptional.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
		inst.unwrap = () => inst._zod.def.innerType;
	});
	function exactOptional(innerType) {
		return new ZodExactOptional({
			type: "optional",
			innerType
		});
	}
	var ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
		$ZodNullable.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
		inst.unwrap = () => inst._zod.def.innerType;
	});
	function nullable(innerType) {
		return new ZodNullable({
			type: "nullable",
			innerType
		});
	}
	var ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
		$ZodDefault.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
		inst.unwrap = () => inst._zod.def.innerType;
		inst.removeDefault = inst.unwrap;
	});
	function _default(innerType, defaultValue) {
		return new ZodDefault({
			type: "default",
			innerType,
			get defaultValue() {
				return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
			}
		});
	}
	var ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
		$ZodPrefault.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
		inst.unwrap = () => inst._zod.def.innerType;
	});
	function prefault(innerType, defaultValue) {
		return new ZodPrefault({
			type: "prefault",
			innerType,
			get defaultValue() {
				return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
			}
		});
	}
	var ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
		$ZodNonOptional.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
		inst.unwrap = () => inst._zod.def.innerType;
	});
	function nonoptional(innerType, params) {
		return new ZodNonOptional({
			type: "nonoptional",
			innerType,
			...normalizeParams(params)
		});
	}
	var ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
		$ZodCatch.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
		inst.unwrap = () => inst._zod.def.innerType;
		inst.removeCatch = inst.unwrap;
	});
	function _catch(innerType, catchValue) {
		return new ZodCatch({
			type: "catch",
			innerType,
			catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
		});
	}
	var ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
		$ZodPipe.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
		inst.in = def.in;
		inst.out = def.out;
	});
	function pipe(in_, out) {
		return new ZodPipe({
			type: "pipe",
			in: in_,
			out
		});
	}
	var ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
		$ZodReadonly.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
		inst.unwrap = () => inst._zod.def.innerType;
	});
	function readonly(innerType) {
		return new ZodReadonly({
			type: "readonly",
			innerType
		});
	}
	var ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
		$ZodCustom.init(inst, def);
		ZodType.init(inst, def);
		inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
	});
	function refine(fn, _params = {}) {
		return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
	}
	function superRefine(fn) {
		return /* @__PURE__ */ _superRefine(fn);
	}
	//#endregion
	//#region src/tracking/parameters.ts
	var parameterDefinitionsForRig = (rig) => rig.parameters;
	function clampParameterValue(rig, id, value) {
		const p = rig.parameters.find((p) => p.id === id);
		if (!p) throw Error("Unknown parameter " + id);
		return Math.max(p.min, Math.min(p.max, value));
	}
	//#endregion
	//#region src/tracking/tracking.ts
	var DEFAULT_TRACKING_INPUTS = [
		{
			id: "faceYaw",
			label: "Face X",
			min: -1,
			max: 1,
			default: 0,
			step: .01
		},
		{
			id: "facePitch",
			label: "Face Y",
			min: -1,
			max: 1,
			default: 0,
			step: .01
		},
		{
			id: "faceRoll",
			label: "Face Z",
			min: -1,
			max: 1,
			default: 0,
			step: .01
		},
		{
			id: "bodyRoll",
			label: "Body Z",
			min: -1,
			max: 1,
			default: 0,
			step: .01
		},
		{
			id: "bodyYaw",
			label: "Body X",
			min: -1,
			max: 1,
			default: 0,
			step: .01
		},
		{
			id: "bodyPitch",
			label: "Body Y",
			min: -1,
			max: 1,
			default: 0,
			step: .01
		},
		{
			id: "mouthOpen",
			label: "Mouth",
			min: 0,
			max: 1,
			default: .12,
			step: .01
		},
		{
			id: "mouthForm",
			label: "Mouth Form",
			min: -1,
			max: 1,
			default: 0,
			step: .01
		},
		{
			id: "mouthSmile",
			label: "Mouth Smile",
			min: -1,
			max: 1,
			default: 0,
			step: .01
		},
		{
			id: "eyeLOpen",
			label: "Eye L",
			min: 0,
			max: 1,
			default: 1,
			step: .01
		},
		{
			id: "eyeROpen",
			label: "Eye R",
			min: 0,
			max: 1,
			default: 1,
			step: .01
		},
		{
			id: "eyeBallX",
			label: "Eye Ball X",
			min: -1,
			max: 1,
			default: 0,
			step: .01
		},
		{
			id: "eyeBallY",
			label: "Eye Ball Y",
			min: -1,
			max: 1,
			default: 0,
			step: .01
		},
		{
			id: "browLY",
			label: "Brow L Y",
			min: -1,
			max: 1,
			default: 0,
			step: .01
		},
		{
			id: "browRY",
			label: "Brow R Y",
			min: -1,
			max: 1,
			default: 0,
			step: .01
		},
		{
			id: "cheek",
			label: "Cheek",
			min: 0,
			max: 1,
			default: 0,
			step: .01
		}
	];
	var DEFAULT_TRACKING_EYE_GAIN = 1.25;
	var DEFAULT_TRACKING_EYE_SYNC = {
		enabled: false,
		winkThreshold: .35,
		winkCurve: "hard",
		leftGain: DEFAULT_TRACKING_EYE_GAIN,
		rightGain: DEFAULT_TRACKING_EYE_GAIN
	};
	var DEFAULT_ONE_EURO_FILTER = {
		minCutoff: 1.1,
		beta: .08,
		derivativeCutoff: 1
	};
	function createTrackingFilterState() {
		return { oneEuro: {} };
	}
	var DEFAULT_MAPPING_SPECS = [
		{
			source: "faceYaw",
			parameter: "ParamAngleX",
			scale: 36,
			offset: 0,
			min: -30,
			max: 30,
			smoothing: .08,
			filter: "one-euro",
			oneEuro: {
				...DEFAULT_ONE_EURO_FILTER,
				beta: .1
			}
		},
		{
			source: "facePitch",
			parameter: "ParamAngleY",
			scale: 42,
			offset: 0,
			min: -30,
			max: 30,
			smoothing: .08,
			filter: "one-euro",
			oneEuro: {
				...DEFAULT_ONE_EURO_FILTER,
				beta: .1
			}
		},
		{
			source: "faceRoll",
			parameter: "ParamAngleZ",
			scale: 36,
			offset: 0,
			min: -30,
			max: 30,
			smoothing: .08,
			filter: "one-euro",
			oneEuro: {
				...DEFAULT_ONE_EURO_FILTER,
				beta: .08
			}
		},
		{
			source: "bodyYaw",
			parameter: "ParamBodyAngleX",
			scale: 24,
			offset: 0,
			min: -30,
			max: 30,
			smoothing: .16,
			filter: "one-euro",
			oneEuro: {
				...DEFAULT_ONE_EURO_FILTER,
				minCutoff: .9,
				beta: .08
			}
		},
		{
			source: "bodyPitch",
			parameter: "ParamBodyAngleY",
			scale: 28,
			offset: 0,
			min: -30,
			max: 30,
			smoothing: .16,
			filter: "one-euro",
			oneEuro: {
				...DEFAULT_ONE_EURO_FILTER,
				minCutoff: .9,
				beta: .08
			}
		},
		{
			source: "mouthOpen",
			parameter: "ParamMouthOpen",
			scale: 1,
			offset: 0,
			min: 0,
			max: 1,
			smoothing: .12
		},
		{
			source: "mouthForm",
			parameter: "ParamMouthForm",
			scale: 1,
			offset: 0,
			min: -1,
			max: 1,
			smoothing: .18
		},
		{
			source: "mouthSmile",
			parameter: "ParamMouthSmile",
			scale: 1,
			offset: 0,
			min: -1,
			max: 1,
			smoothing: .18
		},
		{
			source: "eyeLOpen",
			parameter: "ParamEyeLOpen",
			scale: 1,
			offset: 0,
			min: 0,
			max: 1,
			smoothing: .08
		},
		{
			source: "eyeROpen",
			parameter: "ParamEyeROpen",
			scale: 1,
			offset: 0,
			min: 0,
			max: 1,
			smoothing: .08
		},
		{
			source: "eyeBallX",
			parameter: "ParamEyeBallX",
			scale: 1,
			offset: 0,
			min: -1,
			max: 1,
			smoothing: .15
		},
		{
			source: "eyeBallY",
			parameter: "ParamEyeBallY",
			scale: 1,
			offset: 0,
			min: -1,
			max: 1,
			smoothing: .15
		},
		{
			source: "browLY",
			parameter: "ParamBrowLY",
			scale: 1,
			offset: 0,
			min: -1,
			max: 1,
			smoothing: .2
		},
		{
			source: "browRY",
			parameter: "ParamBrowRY",
			scale: 1,
			offset: 0,
			min: -1,
			max: 1,
			smoothing: .2
		},
		{
			source: "cheek",
			parameter: "ParamCheek",
			scale: 1,
			offset: 0,
			min: 0,
			max: 1,
			smoothing: .25
		}
	];
	function defaultTrackingInputValues() {
		const values = {};
		for (const input of DEFAULT_TRACKING_INPUTS) values[input.id] = input.default;
		return values;
	}
	function createDefaultTracking(rig) {
		return {
			enabled: false,
			provider: "manual",
			inputSmoothing: .25,
			mappings: DEFAULT_MAPPING_SPECS.filter((mapping) => rig.parameters.some((p) => p.id === mapping.parameter)).map((mapping, index) => normalizeTrackingMapping({
				id: `tracking-map-${index + 1}`,
				enabled: true,
				...mapping
			}, rig, index)),
			eyeSync: { ...DEFAULT_TRACKING_EYE_SYNC }
		};
	}
	function normalizeTracking(tracking, rig) {
		if (!tracking || typeof tracking !== "object") return createDefaultTracking(rig);
		const normalized = {
			enabled: typeof tracking.enabled === "boolean" ? tracking.enabled : false,
			provider: tracking.provider === "mediapipe-face-landmarker" ? "mediapipe-face-landmarker" : "manual",
			inputSmoothing: clamp01(finiteNumber(tracking.inputSmoothing, .25)),
			mappings: Array.isArray(tracking.mappings) ? tracking.mappings.map((mapping, index) => normalizeTrackingMapping(mapping, rig, index)) : [],
			calibration: normalizeTrackingCalibration(tracking.calibration),
			eyeSync: normalizeTrackingEyeSync(tracking.eyeSync)
		};
		if (!normalized.mappings.length) normalized.mappings = createDefaultTracking(rig).mappings;
		return normalized;
	}
	function applyTrackingInput(rig, currentParams, inputValues, options = {}) {
		const tracking = normalizeTracking(rig.tracking, rig);
		if (!options.force && !tracking.enabled) return { ...currentParams };
		const processed = preprocessTrackingInputs(tracking, inputValues);
		const next = { ...currentParams };
		for (const mapping of tracking.mappings) {
			if (!mapping.enabled) continue;
			const rawInput = processed[mapping.source];
			if (!Number.isFinite(rawInput)) continue;
			let signedInput = mapping.invert ? -Number(rawInput) : Number(rawInput);
			if (mapping.deadZone) signedInput = applyDeadZone(signedInput, mapping.deadZone);
			if (mapping.filter === "one-euro" && options.filterState) signedInput = applyOneEuroFilter(signedInput, options.filterState, mapping.id, mapping.oneEuro, options.timestampMs);
			signedInput = applyTrackingResponseCurve(signedInput, mapping.responseCurve, mapping.responseGamma);
			let target = signedInput * mapping.scale + mapping.offset;
			if (Number.isFinite(mapping.min)) target = Math.max(Number(mapping.min), target);
			if (Number.isFinite(mapping.max)) target = Math.min(Number(mapping.max), target);
			target = clampParameterValue(rig, mapping.parameter, target);
			const previous = Number.isFinite(next[mapping.parameter]) ? next[mapping.parameter] : target;
			const smoothing = options.smoothing === false ? 0 : clamp01(mapping.smoothing);
			next[mapping.parameter] = roundForTracking(previous + (target - previous) * (1 - smoothing));
		}
		return next;
	}
	/**
	* Applies profile-level input corrections (neutral calibration offsets and
	* eye gain/calibration and eye sync) before per-mapping scale/offset/deadZone
	* are evaluated.
	*/
	function preprocessTrackingInputs(tracking, values) {
		const next = { ...values };
		const inputsById = new Map(DEFAULT_TRACKING_INPUTS.map((input) => [input.id, input]));
		for (const [source, offset] of Object.entries(tracking.calibration ?? {})) {
			const definition = inputsById.get(source);
			const raw = next[source];
			if (!definition || !Number.isFinite(raw) || !Number.isFinite(offset)) continue;
			next[source] = Math.min(definition.max, Math.max(definition.min, Number(raw) - Number(offset)));
		}
		const eyeSync = tracking.eyeSync;
		if (eyeSync) {
			const left = next.eyeLOpen;
			const right = next.eyeROpen;
			if (Number.isFinite(left)) next.eyeLOpen = clamp01(Number(left) * clampTrackingEyeGain(eyeSync.leftGain));
			if (Number.isFinite(right)) next.eyeROpen = clamp01(Number(right) * clampTrackingEyeGain(eyeSync.rightGain));
			if (eyeSync.enabled && Number.isFinite(next.eyeLOpen) && Number.isFinite(next.eyeROpen)) {
				const leftValue = Number(next.eyeLOpen);
				const rightValue = Number(next.eyeROpen);
				const difference = Math.abs(leftValue - rightValue);
				const threshold = eyeSync.winkThreshold;
				if (threshold > 0 && difference < threshold) {
					const average = (leftValue + rightValue) / 2;
					const syncWeight = eyeSync.winkCurve === "smoothstep" ? smoothstep(1 - difference / threshold) : 1;
					next.eyeLOpen = leftValue + (average - leftValue) * syncWeight;
					next.eyeROpen = rightValue + (average - rightValue) * syncWeight;
				}
			}
		}
		return next;
	}
	/**
	* Captures the current raw inputs as the neutral pose. Only zero-centered
	* sources are captured; sources like eyeLOpen (default 1) need gain
	* calibration instead, which is a Phase T1 item in TRACKING_ROADMAP.md.
	*/
	function captureTrackingCalibration(inputValues) {
		const calibration = {};
		for (const input of DEFAULT_TRACKING_INPUTS) {
			if (input.default !== 0) continue;
			const raw = inputValues[input.id];
			if (Number.isFinite(raw) && Math.abs(Number(raw)) > 1e-4) calibration[input.id] = Math.round(Number(raw) * 1e4) / 1e4;
		}
		return calibration;
	}
	function applyDeadZone(value, deadZone) {
		const zone = Math.min(.95, Math.max(0, deadZone));
		if (zone <= 0) return value;
		const magnitude = Math.abs(value);
		if (magnitude <= zone) return 0;
		return Math.sign(value) * ((magnitude - zone) / (1 - zone));
	}
	function applyTrackingResponseCurve(value, curve, gamma) {
		const normalizedCurve = curve ?? "linear";
		if (normalizedCurve === "linear") return value;
		const magnitude = Math.min(1, Math.max(0, Math.abs(value)));
		let shaped = magnitude;
		if (normalizedCurve === "smoothstep") shaped = magnitude * magnitude * (3 - 2 * magnitude);
		else if (normalizedCurve === "gamma") shaped = Math.pow(magnitude, normalizeResponseGamma(gamma));
		return Math.sign(value) * shaped;
	}
	function normalizeTrackingInputValues(values) {
		const normalized = defaultTrackingInputValues();
		const inputsById = new Map(DEFAULT_TRACKING_INPUTS.map((input) => [input.id, input]));
		for (const [key, value] of Object.entries(values)) {
			const definition = inputsById.get(key);
			if (!definition || !Number.isFinite(value)) continue;
			normalized[key] = Math.min(definition.max, Math.max(definition.min, Number(value)));
		}
		return normalized;
	}
	function normalizeTrackingMapping(mapping, rig, index) {
		const sourceIds = new Set(DEFAULT_TRACKING_INPUTS.map((input) => input.id));
		const parameterIds = new Set(parameterDefinitionsForRig(rig).map((parameter) => parameter.id));
		const fallbackSpec = DEFAULT_MAPPING_SPECS[index % DEFAULT_MAPPING_SPECS.length] ?? DEFAULT_MAPPING_SPECS[0];
		const source = typeof mapping.source === "string" && sourceIds.has(mapping.source) ? mapping.source : fallbackSpec.source;
		const parameter = typeof mapping.parameter === "string" && parameterIds.has(mapping.parameter) ? mapping.parameter : fallbackSpec.parameter;
		return {
			id: typeof mapping.id === "string" && mapping.id.trim() ? mapping.id : `tracking-map-${index + 1}`,
			enabled: typeof mapping.enabled === "boolean" ? mapping.enabled : true,
			source,
			parameter,
			scale: finiteNumber(mapping.scale, fallbackSpec.scale),
			offset: finiteNumber(mapping.offset, fallbackSpec.offset),
			min: optionalFiniteNumber(mapping.min),
			max: optionalFiniteNumber(mapping.max),
			smoothing: clamp01(finiteNumber(mapping.smoothing, fallbackSpec.smoothing)),
			invert: mapping.invert === true,
			deadZone: normalizeDeadZone(mapping.deadZone),
			filter: mapping.filter === "one-euro" ? "one-euro" : mapping.filter === "ema" ? "ema" : fallbackSpec.filter ?? "ema",
			oneEuro: normalizeOneEuroOptions(mapping.oneEuro ?? fallbackSpec.oneEuro),
			responseCurve: normalizeResponseCurve(mapping.responseCurve ?? fallbackSpec.responseCurve),
			responseGamma: normalizeResponseGamma(mapping.responseGamma ?? fallbackSpec.responseGamma)
		};
	}
	function normalizeResponseCurve(value) {
		return value === "smoothstep" || value === "gamma" ? value : "linear";
	}
	function normalizeResponseGamma(value) {
		return Math.min(4, Math.max(.25, finiteNumber(value, 1)));
	}
	function normalizeOneEuroOptions(value) {
		const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
		return {
			minCutoff: Math.max(.01, finiteNumber(record.minCutoff, DEFAULT_ONE_EURO_FILTER.minCutoff)),
			beta: Math.max(0, finiteNumber(record.beta, DEFAULT_ONE_EURO_FILTER.beta)),
			derivativeCutoff: Math.max(.01, finiteNumber(record.derivativeCutoff, DEFAULT_ONE_EURO_FILTER.derivativeCutoff))
		};
	}
	function applyOneEuroFilter(value, state, mappingId, options, timestampMs) {
		const now = Number.isFinite(timestampMs) ? Number(timestampMs) : Date.now();
		const config = normalizeOneEuroOptions(options);
		const previous = state.oneEuro[mappingId];
		if (!previous || now <= previous.timestampMs) {
			state.oneEuro[mappingId] = {
				value,
				derivative: 0,
				timestampMs: now
			};
			return value;
		}
		const dt = Math.min(1, Math.max(1 / 240, (now - previous.timestampMs) / 1e3));
		const derivative = (value - previous.value) / dt;
		const derivativeAlpha = smoothingAlpha(config.derivativeCutoff, dt);
		const filteredDerivative = derivativeAlpha * derivative + (1 - derivativeAlpha) * previous.derivative;
		const valueAlpha = smoothingAlpha(config.minCutoff + config.beta * Math.abs(filteredDerivative), dt);
		const filteredValue = valueAlpha * value + (1 - valueAlpha) * previous.value;
		state.oneEuro[mappingId] = {
			value: filteredValue,
			derivative: filteredDerivative,
			timestampMs: now
		};
		return filteredValue;
	}
	function smoothingAlpha(cutoff, dt) {
		return 1 / (1 + 1 / (2 * Math.PI * Math.max(.01, cutoff)) / dt);
	}
	function normalizeDeadZone(value) {
		if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
		return Math.min(.95, value);
	}
	function normalizeTrackingCalibration(calibration) {
		if (!calibration || typeof calibration !== "object" || Array.isArray(calibration)) return;
		const sourceIds = new Set(DEFAULT_TRACKING_INPUTS.map((input) => input.id));
		const normalized = {};
		for (const [key, value] of Object.entries(calibration)) if (sourceIds.has(key) && typeof value === "number" && Number.isFinite(value) && value !== 0) normalized[key] = value;
		return Object.keys(normalized).length ? normalized : void 0;
	}
	function normalizeTrackingEyeSync(eyeSync) {
		if (!eyeSync || typeof eyeSync !== "object" || Array.isArray(eyeSync)) return { ...DEFAULT_TRACKING_EYE_SYNC };
		const record = eyeSync;
		return {
			enabled: record.enabled === true,
			winkThreshold: clamp01(finiteNumber(record.winkThreshold, DEFAULT_TRACKING_EYE_SYNC.winkThreshold)),
			winkCurve: record.winkCurve === "smoothstep" ? "smoothstep" : "hard",
			leftGain: clampTrackingEyeGain(finiteNumber(record.leftGain, DEFAULT_TRACKING_EYE_GAIN)),
			rightGain: clampTrackingEyeGain(finiteNumber(record.rightGain, DEFAULT_TRACKING_EYE_GAIN))
		};
	}
	function clampTrackingEyeGain(value) {
		return Math.min(2, Math.max(.25, finiteNumber(value, DEFAULT_TRACKING_EYE_GAIN)));
	}
	function smoothstep(value) {
		const t = clamp01(value);
		return t * t * (3 - 2 * t);
	}
	function finiteNumber(value, fallback) {
		return typeof value === "number" && Number.isFinite(value) ? value : fallback;
	}
	function optionalFiniteNumber(value) {
		return typeof value === "number" && Number.isFinite(value) ? value : void 0;
	}
	function clamp01(value) {
		return Math.min(1, Math.max(0, value));
	}
	function roundForTracking(value) {
		return Math.round(value * 1e4) / 1e4;
	}
	//#endregion
	//#region src/tracking/profile.ts
	var finite$1 = number().finite();
	var mapping = strictObject({
		id: string().min(1),
		enabled: boolean(),
		source: _enum(DEFAULT_TRACKING_INPUTS.map((p) => p.id)),
		parameter: string().min(1),
		scale: finite$1,
		offset: finite$1,
		min: finite$1.optional(),
		max: finite$1.optional(),
		smoothing: finite$1.min(0).max(1),
		invert: boolean().optional(),
		deadZone: finite$1.min(0).max(.99).optional(),
		filter: _enum(["ema", "one-euro"]).optional(),
		oneEuro: strictObject({
			minCutoff: finite$1.positive().optional(),
			beta: finite$1.nonnegative().optional(),
			derivativeCutoff: finite$1.positive().optional()
		}).optional(),
		responseCurve: _enum([
			"linear",
			"smoothstep",
			"gamma"
		]).optional(),
		responseGamma: finite$1.positive().optional()
	});
	var profileSchema = strictObject({
		format: literal("standrig-tracking-profile"),
		version: literal(1),
		name: string(),
		updatedAt: string().optional(),
		tracking: strictObject({
			enabled: boolean(),
			provider: _enum(["manual", "mediapipe-face-landmarker"]),
			inputSmoothing: finite$1.min(0).max(1),
			mappings: array(mapping).min(1).max(256),
			calibration: record(string(), finite$1).optional(),
			eyeSync: strictObject({
				enabled: boolean(),
				winkThreshold: finite$1.min(0).max(1),
				winkCurve: _enum(["hard", "smoothstep"]).optional(),
				leftGain: finite$1.positive().optional(),
				rightGain: finite$1.positive().optional()
			}).optional()
		})
	});
	function parseProfile(value, parameters) {
		const p = profileSchema.parse(value);
		const ids = /* @__PURE__ */ new Set();
		for (const m of p.tracking.mappings) {
			if (ids.has(m.id)) throw Error("Duplicate mapping ID " + m.id);
			ids.add(m.id);
			if (!parameters.some((p) => p.id === m.parameter)) throw Error("Unknown parameter " + m.parameter);
			if (m.min !== void 0 && m.max !== void 0 && m.min > m.max) throw Error("Invalid mapping range");
		}
		for (const id of Object.keys(p.tracking.calibration ?? {})) if (!DEFAULT_TRACKING_INPUTS.some((p) => p.id === id)) throw Error("Unknown calibration input " + id);
		return p;
	}
	//#endregion
	//#region scripts/evaluation/tracking-session.ts
	var parameters;
	var profile$1;
	var previous;
	var filters = createTrackingFilterState();
	var lastTime$1;
	function initializeTracking(definitions) {
		parameters = definitions;
		profile$1 = void 0;
		resetTracking();
	}
	function resetTracking() {
		previous = Object.fromEntries((parameters ?? []).map((p) => [p.id, p.default]));
		filters = createTrackingFilterState();
		lastTime$1 = void 0;
	}
	function loadTrackingProfile(json, preserveState = false) {
		if (!parameters) throw Error("load a model first");
		const next = parseProfile(JSON.parse(json), parameters);
		if (parameters.some((p) => p.id === "ParamBodyAngleZ") && !next.tracking.mappings.some((m) => m.source === "bodyRoll" || m.parameter === "ParamBodyAngleZ")) {
			let id = "connect-body-roll";
			while (next.tracking.mappings.some((m) => m.id === id)) id += "-";
			next.tracking.mappings.push({
				id,
				enabled: true,
				source: "bodyRoll",
				parameter: "ParamBodyAngleZ",
				scale: 15,
				offset: 0,
				smoothing: .15,
				filter: "ema",
				invert: false
			});
		}
		profile$1 = next;
		if (!preserveState) resetTracking();
		return JSON.stringify({
			name: next.name,
			enabled: next.tracking.enabled,
			mappings: next.tracking.mappings.length
		});
	}
	function mapTracking(json) {
		if (!profile$1 || !parameters) throw Error("load a tracking profile first");
		const request = JSON.parse(json);
		if (!request || Array.isArray(request) || typeof request !== "object" || Object.keys(request).some((k) => !["timestampMs", "inputs"].includes(k))) throw Error("invalid tracking request");
		const time = request.timestampMs, inputs = request.inputs;
		if (!Number.isFinite(time) || time < 0 || time > 0xe8d4a51000 || lastTime$1 !== void 0 && time < lastTime$1) throw Error("invalid tracking timestamp");
		if (!inputs || Array.isArray(inputs) || typeof inputs !== "object") throw Error("invalid tracking inputs");
		for (const [id, value] of Object.entries(inputs)) {
			const d = DEFAULT_TRACKING_INPUTS.find((p) => p.id === id);
			if (!d || typeof value !== "number" || !Number.isFinite(value) || value < d.min || value > d.max) throw Error("invalid tracking input " + id);
		}
		const nextFilters = { oneEuro: Object.fromEntries(Object.entries(filters.oneEuro).map(([k, v]) => [k, { ...v }])) };
		const next = applyTrackingInput({
			parameters,
			tracking: profile$1.tracking
		}, previous, inputs, {
			filterState: nextFilters,
			timestampMs: time
		});
		if (Object.values(next).some((v) => !Number.isFinite(v))) throw Error("non-finite tracking output");
		const result = {};
		if (profile$1.tracking.enabled) {
			for (const m of profile$1.tracking.mappings) if (m.enabled && inputs[m.source] !== void 0) result[m.parameter] = next[m.parameter];
		}
		filters = nextFilters;
		previous = next;
		lastTime$1 = time;
		return JSON.stringify(result);
	}
	function calibrateTracking(json) {
		if (!profile$1) throw Error("load a tracking profile first");
		const inputs = JSON.parse(json);
		if (inputs !== null) {
			if (!inputs || Array.isArray(inputs) || typeof inputs !== "object") throw Error("invalid calibration input");
			for (const [id, value] of Object.entries(inputs)) {
				const d = DEFAULT_TRACKING_INPUTS.find((p) => p.id === id);
				if (!d || typeof value !== "number" || !Number.isFinite(value) || value < d.min || value > d.max) throw Error("invalid calibration input " + id);
			}
		}
		profile$1 = {
			...profile$1,
			tracking: {
				...profile$1.tracking,
				calibration: inputs === null ? {} : captureTrackingCalibration(inputs)
			}
		};
		resetTracking();
	}
	function exportTrackingProfile() {
		if (!profile$1) throw Error("load a tracking profile first");
		return JSON.stringify(profile$1, null, 2);
	}
	//#endregion
	//#region src/tracking/faceInputs.ts
	function faceLandmarkerResultToTrackingInput(result) {
		const landmarkAngles = rotationFromMatrix(result.facialTransformationMatrixes?.[0]) ?? rotationFromLandmarks(result.faceLandmarks?.[0]);
		const blendshapes = blendshapeScores(result.faceBlendshapes?.[0]);
		const score = (name) => firstFinite(blendshapes.get(name));
		const mouthRound = Math.max(score("mouthFunnel"), score("mouthPucker"));
		const mouthWide = Math.max(score("mouthStretchLeft"), score("mouthStretchRight"));
		const mouthSmile = (score("mouthSmileLeft") + score("mouthSmileRight")) * .5;
		const mouthFrown = (score("mouthFrownLeft") + score("mouthFrownRight")) * .5;
		const eyeBallX = (score("eyeLookOutLeft") - score("eyeLookInLeft") + (score("eyeLookInRight") - score("eyeLookOutRight"))) * .5;
		const eyeBallY = (score("eyeLookUpLeft") + score("eyeLookUpRight") - (score("eyeLookDownLeft") + score("eyeLookDownRight"))) * .5;
		const browInnerUp = score("browInnerUp");
		const browLY = browInnerUp * .5 + score("browOuterUpLeft") * .7 - score("browDownLeft");
		const browRY = browInnerUp * .5 + score("browOuterUpRight") * .7 - score("browDownRight");
		return normalizeTrackingInputValues({
			faceYaw: landmarkAngles?.yaw ?? 0,
			facePitch: landmarkAngles?.pitch ?? 0,
			faceRoll: landmarkAngles?.roll ?? 0,
			bodyYaw: (landmarkAngles?.yaw ?? 0) * .55,
			bodyPitch: (landmarkAngles?.pitch ?? 0) * .45,
			mouthOpen: firstFinite(blendshapes.get("jawOpen"), blendshapes.get("mouthFunnel"), blendshapes.get("mouthPucker"), .12),
			mouthForm: clampSigned(mouthRound - mouthWide),
			mouthSmile: clampSigned(mouthSmile - mouthFrown),
			eyeLOpen: 1 - firstFinite(blendshapes.get("eyeBlinkLeft"), 0),
			eyeROpen: 1 - firstFinite(blendshapes.get("eyeBlinkRight"), 0),
			eyeBallX: clampSigned(eyeBallX),
			eyeBallY: clampSigned(eyeBallY),
			browLY: clampSigned(browLY),
			browRY: clampSigned(browRY),
			cheek: Math.min(1, Math.max(0, score("cheekPuff")))
		});
	}
	function rotationFromMatrix(matrix) {
		const data = matrix?.data;
		if (!data || data.length < 16) return;
		const m00 = data[0];
		data[1];
		const m02 = data[2];
		const m10 = data[4];
		const m11 = data[5];
		const m12 = data[6];
		data[8];
		data[9];
		const m22 = data[10];
		const pitch = Math.atan2(-m12, Math.hypot(m02, m22));
		return normalizeAngles(Math.atan2(m02, m22), pitch, Math.atan2(m10, m00 || m11));
	}
	function rotationFromLandmarks(landmarks) {
		if (!landmarks?.length) return;
		const leftEye = landmarks[33];
		const rightEye = landmarks[263];
		const nose = landmarks[1];
		const chin = landmarks[152];
		if (!leftEye || !rightEye || !nose || !chin) return;
		const eyeMidX = (leftEye.x + rightEye.x) / 2;
		const eyeMidY = (leftEye.y + rightEye.y) / 2;
		const eyeDistance = Math.max(.001, Math.abs(rightEye.x - leftEye.x));
		return normalizeAngles((nose.x - eyeMidX) / eyeDistance, (nose.y - eyeMidY) / Math.max(.001, Math.abs(chin.y - eyeMidY)) - .33, Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x));
	}
	function normalizeAngles(yaw, pitch, roll) {
		return {
			yaw: clampSigned(yaw / .55),
			pitch: clampSigned(pitch / .45),
			roll: clampSigned(roll / .55)
		};
	}
	function blendshapeScores(classifications) {
		const scores = /* @__PURE__ */ new Map();
		for (const category of classifications?.categories ?? []) scores.set(category.categoryName, category.score);
		return scores;
	}
	function firstFinite(...values) {
		for (const value of values) if (typeof value === "number" && Number.isFinite(value)) return value;
		return 0;
	}
	function clampSigned(value) {
		return Math.min(1, Math.max(-1, Number.isFinite(value) ? value : 0));
	}
	//#endregion
	//#region scripts/evaluation/face-input.ts
	function convertFace(json) {
		const face = JSON.parse(json);
		if (!face || Array.isArray(face) || typeof face !== "object" || Object.keys(face).some((k) => ![
			"Count",
			"Blendshapes",
			"MatrixRowMajor"
		].includes(k)) || ![0, 1].includes(face.Count)) throw Error("invalid face observation");
		if (face.Count === 0) return "null";
		if (!Array.isArray(face.MatrixRowMajor) || face.MatrixRowMajor.length !== 16 || !face.MatrixRowMajor.every((n) => typeof n === "number" && Number.isFinite(n))) throw Error("invalid face matrix");
		if (!face.Blendshapes || Array.isArray(face.Blendshapes) || typeof face.Blendshapes !== "object") throw Error("invalid face blendshapes");
		const entries = Object.entries(face.Blendshapes);
		if (entries.length === 0 || entries.length > 256) throw Error("invalid face blendshape count");
		const categories = entries.map(([categoryName, score]) => {
			if (!categoryName || typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) throw Error("invalid face score");
			return {
				categoryName,
				score,
				index: 0,
				displayName: ""
			};
		});
		return JSON.stringify(faceLandmarkerResultToTrackingInput({
			faceLandmarks: [],
			faceBlendshapes: [{ categories }],
			facialTransformationMatrixes: [{
				rows: 4,
				columns: 4,
				data: face.MatrixRowMajor
			}]
		}));
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/motion.ts
	function object(value, keys) {
		if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((k) => !keys.includes(k))) throw Error("invalid motion object/unknown field");
	}
	var finite = (v) => typeof v === "number" && Number.isFinite(v);
	function parseMotion(value) {
		object(value, [
			"format",
			"version",
			"name",
			"duration",
			"tracks"
		]);
		if (value.format !== "standrig-motion" || value.version !== 1) throw Error("unsupported motion format/version; Live2D conversion is not installed");
		if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 160 || !finite(value.duration) || value.duration <= 0 || value.duration > 3600) throw Error("invalid motion name/duration");
		if (!Array.isArray(value.tracks) || !value.tracks.length || value.tracks.length > 256) throw Error("motion requires 1..256 tracks");
		const ids = /* @__PURE__ */ new Set();
		let total = 0;
		for (const track of value.tracks) {
			object(track, ["parameter", "keys"]);
			if (typeof track.parameter !== "string" || !track.parameter || track.parameter.length > 160 || ids.has(track.parameter)) throw Error("invalid/duplicate motion parameter");
			ids.add(track.parameter);
			if (!Array.isArray(track.keys) || !track.keys.length || track.keys.length > 4096 || (total += track.keys.length) > 5e4) throw Error("invalid motion key count");
			for (let i = 0; i < track.keys.length; i++) {
				const key = track.keys[i];
				object(key, [
					"time",
					"value",
					"segment"
				]);
				if (!finite(key.time) || !finite(key.value) || key.time < 0 || key.time > value.duration || i && key.time <= track.keys[i - 1].time) throw Error("motion keys must have finite values and strictly increasing times");
				if (key.segment !== void 0) {
					object(key.segment, [
						"kind",
						"control1",
						"control2"
					]);
					const s = key.segment;
					if (![
						"linear",
						"hold",
						"inverse-hold",
						"bezier"
					].includes(String(s.kind))) throw Error("unsupported motion segment");
					if (i === track.keys.length - 1) throw Error("last motion key cannot have an outgoing segment");
					if (s.kind === "bezier") {
						for (const c of [s.control1, s.control2]) {
							object(c, ["time", "value"]);
							if (!finite(c.time) || !finite(c.value)) throw Error("invalid bezier controls");
						}
						const a = s.control1, b = s.control2;
						if (a.time < key.time || b.time < a.time || b.time > track.keys[i + 1].time) throw Error("bezier control times must be monotone within the segment");
					} else if (s.control1 !== void 0 || s.control2 !== void 0) throw Error("unexpected segment controls");
				}
			}
		}
		return JSON.parse(JSON.stringify(value));
	}
	function validateMotionParameters(clip, parameters) {
		const defs = new Map(parameters.map((p) => [p.id, p]));
		for (const track of clip.tracks) {
			const p = defs.get(track.parameter);
			if (!p) throw Error("unknown motion parameter: " + track.parameter);
			for (const key of track.keys) if ([key.value, ...key.segment?.kind === "bezier" ? [key.segment.control1.value, key.segment.control2.value] : []].some((v) => v < p.min || v > p.max)) throw Error("motion values/control hull outside model range: " + p.id);
		}
	}
	var cubic = (a, b, c, d, t) => {
		const u = 1 - t;
		return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
	};
	function sampleMotionTrack(track, time) {
		const keys = track.keys;
		if (time <= keys[0].time) return keys[0].value;
		if (time >= keys[keys.length - 1].time) return keys[keys.length - 1].value;
		let lo = 0, hi = keys.length - 1;
		while (hi - lo > 1) {
			const mid = lo + hi >> 1;
			if (keys[mid].time <= time) lo = mid;
			else hi = mid;
		}
		const a = keys[lo], b = keys[hi], kind = a.segment?.kind ?? "linear";
		if (time === a.time) return a.value;
		if (kind === "hold") return a.value;
		if (kind === "inverse-hold") return b.value;
		if (a.segment?.kind === "bezier") {
			const s = a.segment;
			let left = 0, right = 1;
			for (let i = 0; i < 45; i++) {
				const t = (left + right) / 2;
				if (cubic(a.time, s.control1.time, s.control2.time, b.time, t) < time) left = t;
				else right = t;
			}
			return cubic(a.value, s.control1.value, s.control2.value, b.value, (left + right) / 2);
		}
		const fraction = (time - a.time) / (b.time - a.time);
		return (1 - fraction) * a.value + fraction * b.value;
	}
	/** Sample a previously validated clip. Values before/after a track's keys hold endpoints. */
	function sampleMotion(clip, time) {
		if (!Number.isFinite(time)) throw Error("invalid motion sample time");
		return Object.fromEntries(clip.tracks.map((t) => [t.parameter, sampleMotionTrack(t, time)]));
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/tint.ts
	function validatePartTint(tint) {
		if (!tint) return [];
		const issues = [];
		if (tint.mode !== "multiply" && tint.mode !== "screen") issues.push("tint-mode-invalid");
		if (typeof tint.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(tint.color)) issues.push("tint-color-invalid");
		if (!Number.isFinite(tint.opacity) || tint.opacity < 0 || tint.opacity > 1) issues.push("tint-opacity-invalid");
		return issues;
	}
	function parseTintColor(color) {
		const value = color.replace(/^#/, "");
		return [
			parseInt(value.slice(0, 2), 16),
			parseInt(value.slice(2, 4), 16),
			parseInt(value.slice(4, 6), 16)
		];
	}
	function applyTintChannel(source, tint, opacity, mode) {
		const s = source / 255;
		const t = tint / 255;
		const blended = mode === "multiply" ? s * t : 1 - (1 - s) * (1 - t);
		return Math.round(255 * (s * (1 - opacity) + blended * opacity));
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/contourShade.ts
	function validateContourShade(shade) {
		return Boolean(shade && /^#[0-9a-fA-F]{6}$/.test(shade.color) && typeof shade.yawParameter === "string" && shade.yawParameter.length && typeof shade.pitchParameter === "string" && shade.pitchParameter.length && Number.isFinite(shade.maxYaw) && shade.maxYaw > 0 && Number.isFinite(shade.maxPitch) && shade.maxPitch > 0 && Number.isFinite(shade.width) && shade.width > 0 && shade.width <= .5 && Number.isFinite(shade.strength) && shade.strength >= 0 && shade.strength <= 1 && Number.isFinite(shade.axisStrength) && shade.axisStrength >= 0 && shade.axisStrength <= 1 && (shade.profile === void 0 || shade.profile === "cheek") && (shade.farContourFade === void 0 || Number.isFinite(shade.farContourFade) && shade.farContourFade >= 0 && shade.farContourFade <= 1) && (shade.nearContourFade === void 0 || Number.isFinite(shade.nearContourFade) && shade.nearContourFade >= 0 && shade.nearContourFade <= 1) && (shade.upContourFade === void 0 || Number.isFinite(shade.upContourFade) && shade.upContourFade >= 0 && shade.upContourFade <= 1) && (shade.upShadowStrength === void 0 || Number.isFinite(shade.upShadowStrength) && shade.upShadowStrength >= 0 && shade.upShadowStrength <= 1) && (shade.lineWidth === void 0 || Number.isFinite(shade.lineWidth) && shade.lineWidth > 0 && shade.lineWidth <= .1));
	}
	var smooth = (value) => {
		const t = Math.min(1, Math.max(0, value));
		return t * t * (3 - 2 * t);
	};
	var ContourShadeProcessor = class {
		source;
		shade;
		left;
		right;
		color;
		lastKey = "";
		lastImage;
		volumeLeft;
		volumeRight;
		fadeLeft;
		fadeRight;
		nearFadeLeft;
		nearFadeRight;
		skinLeft;
		skinRight;
		jawInk;
		jawShadow;
		jawSkin;
		constructor(source, shade) {
			this.source = source;
			this.shade = shade;
			this.left = new Float32Array(source.width * source.height);
			this.right = new Float32Array(this.left.length);
			this.color = [
				1,
				3,
				5
			].map((i) => parseInt(shade.color.slice(i, i + 2), 16) / 255);
			this.lastImage = source;
			if (shade.profile === "cheek") {
				this.volumeLeft = [
					-1,
					0,
					1
				].map(() => new Float32Array(this.left.length));
				this.volumeRight = [
					-1,
					0,
					1
				].map(() => new Float32Array(this.left.length));
			}
			if (shade.farContourFade || shade.nearContourFade) {
				this.fadeLeft = new Float32Array(this.left.length);
				this.fadeRight = new Float32Array(this.left.length);
				this.skinLeft = new Float32Array(source.height * 3);
				this.skinRight = new Float32Array(source.height * 3);
			}
			if (shade.nearContourFade) {
				this.nearFadeLeft = new Float32Array(this.left.length);
				this.nearFadeRight = new Float32Array(this.left.length);
			}
			const band = Math.max(1, source.width * shade.width);
			for (let y = 0; y < source.height; y++) {
				let l = source.width, r = -1;
				for (let x = 0; x < source.width; x++) if (source.data[(y * source.width + x) * 4 + 3] > 0) {
					l = Math.min(l, x);
					r = x;
				}
				if (r < l) continue;
				let surfaceL = l, surfaceR = r, runStart = -1, longest = 0;
				if (this.volumeLeft || this.fadeLeft) {
					for (let x = l; x <= r + 1; x++) if (x <= r && source.data[(y * source.width + x) * 4 + 3] >= 128) {
						if (runStart < 0) runStart = x;
					} else if (runStart >= 0) {
						if (x - runStart > longest) {
							longest = x - runStart;
							surfaceL = runStart;
							surfaceR = x - 1;
						}
						runStart = -1;
					}
				}
				const v = y / Math.max(1, source.height - 1);
				const inkBand = Math.max(1, source.width * (shade.lineWidth ?? .035));
				const inset = Math.min((surfaceR - surfaceL) / 2, inkBand * 2.1);
				const skinX = [Math.round(surfaceL + inset), Math.round(surfaceR - inset)];
				for (let c = 0; c < 3; c++) {
					if (this.skinLeft) this.skinLeft[y * 3 + c] = source.data[(y * source.width + skinX[0]) * 4 + c];
					if (this.skinRight) this.skinRight[y * 3 + c] = source.data[(y * source.width + skinX[1]) * 4 + c];
				}
				const cheekInk = smooth((v - .56) / .09) * (1 - smooth((v - .88) / .08));
				const nearCheekInk = smooth((v - .63) / .17) * (1 - smooth((v - .985) / .015));
				const widths = [
					-1,
					0,
					1
				].map((pitch) => band * (.4 + .85 * Math.exp(-(((v - (.7 + .055 * pitch)) / .17) ** 2))) * (1 - .6 * smooth((v - .87) / .11)));
				const cheekPlane = smooth((v - .4) / .16) * (1 - .75 * smooth((v - .94) / .06));
				for (let x = l; x <= r; x++) {
					const p = y * source.width + x;
					this.left[p] = Math.exp(-(((x - l) / band) ** 2));
					this.right[p] = Math.exp(-(((r - x) / band) ** 2));
					if (this.volumeLeft && this.volumeRight) for (let k = 0; k < 3; k++) {
						this.volumeLeft[k][p] = cheekPlane * (1 - smooth(((x - surfaceL) / widths[k] - .2) / .8));
						this.volumeRight[k][p] = cheekPlane * (1 - smooth(((surfaceR - x) / widths[k] - .2) / .8));
					}
					for (const [distance, field, nearField, skin] of [[
						x - surfaceL,
						this.fadeLeft,
						this.nearFadeLeft,
						this.skinLeft
					], [
						surfaceR - x,
						this.fadeRight,
						this.nearFadeRight,
						this.skinRight
					]]) {
						if (!field || !skin) continue;
						const i = p * 4;
						const contrast = (skin[y * 3] - source.data[i]) * .2126 + (skin[y * 3 + 1] - source.data[i + 1]) * .7152 + (skin[y * 3 + 2] - source.data[i + 2]) * .0722;
						const edgeInk = distance < -inkBand ? 0 : (1 - smooth((distance / inkBand - .5) / .5)) * smooth((contrast - 5) / 26);
						field[p] = cheekInk * edgeInk;
						if (nearField) nearField[p] = nearCheekInk * edgeInk;
					}
				}
			}
		}
		prepareJaw() {
			if (this.jawInk) return;
			const { width, height, data } = this.source;
			this.jawInk = new Float32Array(width * height);
			this.jawShadow = new Float32Array(width * height);
			this.jawSkin = new Float32Array(width * 3);
			const inkBand = Math.max(1, width * (this.shade.lineWidth ?? .035));
			const shadowBand = Math.max(1, height * .075);
			for (let x = 0; x < width; x++) {
				let start = -1, bottom = -1, longest = 0;
				for (let y = Math.floor(height * .5); y <= height; y++) if (y < height && data[(y * width + x) * 4 + 3] >= 128) {
					if (start < 0) start = y;
				} else if (start >= 0) {
					if (y - start > longest) {
						longest = y - start;
						bottom = y - 1;
					}
					start = -1;
				}
				if (bottom < 0) continue;
				const sampleY = Math.round(bottom - Math.min(longest / 2, inkBand * 2.1));
				for (let c = 0; c < 3; c++) this.jawSkin[x * 3 + c] = data[(sampleY * width + x) * 4 + c];
				const lateral = 1 - smooth((Math.abs(x / Math.max(1, width - 1) - .5) - .16) / .24);
				for (let y = Math.floor(height * .78); y < height; y++) {
					const p = y * width + x, i = p * 4, distance = bottom - y;
					if (distance < -inkBand || !data[i + 3]) continue;
					const lowerJaw = lateral * smooth((y / Math.max(1, height - 1) - .78) / .13);
					const contrast = (this.jawSkin[x * 3] - data[i]) * .2126 + (this.jawSkin[x * 3 + 1] - data[i + 1]) * .7152 + (this.jawSkin[x * 3 + 2] - data[i + 2]) * .0722;
					this.jawInk[p] = lowerJaw * (1 - smooth((distance / inkBand - .5) / .5)) * smooth((contrast - 5) / 26);
					this.jawShadow[p] = lowerJaw * Math.exp(-((Math.max(0, distance) / shadowBand) ** 2));
				}
			}
		}
		render(values) {
			const yaw = values[this.shade.yawParameter] ?? 0;
			const pitch = values[this.shade.pitchParameter] ?? 0;
			if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return this.source;
			const yawWeight = smooth(Math.abs(yaw) / this.shade.maxYaw);
			const fade = (this.shade.farContourFade ?? 0) * yawWeight;
			const nearFade = (this.shade.nearContourFade ?? 0) * smooth(Math.abs(yaw) / (this.shade.maxYaw * 2 / 3));
			const upWeight = smooth(-pitch / this.shade.maxPitch);
			const upFade = (this.shade.upContourFade ?? 0) * upWeight;
			const upShadow = (this.shade.upShadowStrength ?? 0) * upWeight;
			if (upFade > 0 || upShadow > 0) this.prepareJaw();
			const strength = this.shade.strength * smooth(Math.abs(yaw) / this.shade.maxYaw) * (this.shade.axisStrength + (1 - this.shade.axisStrength) * smooth(Math.abs(pitch) / this.shade.maxPitch));
			if (strength <= 0 && fade <= 0 && nearFade <= 0 && upFade <= 0 && upShadow <= 0) return this.source;
			const pitchWeight = Math.min(1, Math.abs(pitch) / this.shade.maxPitch);
			const key = `${yaw < 0}:${strength}:${fade}:${nearFade}:${upFade}:${upShadow}:${this.shade.profile ? pitch : 0}`;
			if (key === this.lastKey) return this.lastImage;
			const weights = yaw < 0 ? this.right : this.left;
			const volume = yaw < 0 ? this.volumeRight : this.volumeLeft;
			const fadeWeights = yaw < 0 ? this.fadeLeft : this.fadeRight;
			const skin = yaw < 0 ? this.skinLeft : this.skinRight;
			const nearFadeWeights = yaw < 0 ? this.nearFadeRight : this.nearFadeLeft;
			const nearSkin = yaw < 0 ? this.skinRight : this.skinLeft;
			const data = new Uint8ClampedArray(this.source.data);
			for (let p = 0; p < weights.length; p++) {
				const i = p * 4;
				if (!data[i + 3]) continue;
				const a = (volume ? volume[1][p] * (1 - pitchWeight) + volume[pitch < 0 ? 0 : 2][p] * pitchWeight : weights[p]) * strength;
				const ink = fade * (fadeWeights?.[p] ?? 0);
				const nearInk = nearFade * (nearFadeWeights?.[p] ?? 0);
				const jawInk = upFade * (this.jawInk?.[p] ?? 0);
				const jawShade = upShadow * (this.jawShadow?.[p] ?? 0);
				const column = p % this.source.width * 3;
				const row = Math.floor(p / this.source.width) * 3;
				for (let c = 0; c < 3; c++) {
					const skinColor = skin?.[row + c] ?? data[i + c];
					const farSoftened = data[i + c] + ink * (skinColor - data[i + c]);
					const softened = farSoftened + nearInk * ((nearSkin?.[row + c] ?? farSoftened) - farSoftened);
					const jawSoftened = softened + jawInk * ((this.jawSkin?.[column + c] ?? softened) - softened);
					const combinedShade = jawShade > 0 ? 1 - (1 - a) * (1 - jawShade) : a;
					data[i + c] = Math.round(jawSoftened * (1 - combinedShade * (1 - this.color[c])));
				}
			}
			this.lastKey = key;
			return this.lastImage = {
				width: this.source.width,
				height: this.source.height,
				data
			};
		}
	};
	var processors$1 = /* @__PURE__ */ new WeakMap();
	function applyContourShade(source, shade, values) {
		if (!shade || !validateContourShade(shade)) return source;
		const key = JSON.stringify(shade);
		let entry = processors$1.get(source);
		if (!entry || entry.key !== key) {
			entry = {
				key,
				processor: new ContourShadeProcessor(source, shade)
			};
			processors$1.set(source, entry);
		}
		return entry.processor.render(values);
	}
	//#endregion
	//#region workspace/vendor/standrig-evaluation/35641e23619a23e5f6fe1b1a26e21f61485f1221/packages/core/src/alphaReveal.ts
	function validateAlphaReveal(reveal) {
		return Boolean(reveal && typeof reveal.parameter === "string" && reveal.parameter.length && Number.isFinite(reveal.closed) && Number.isFinite(reveal.open) && reveal.open > reveal.closed && Number.isFinite(reveal.exponent) && reveal.exponent > 0 && reveal.exponent <= 4 && (reveal.anchor === void 0 || Number.isFinite(reveal.anchor) && reveal.anchor >= 0 && reveal.anchor <= 1));
	}
	/** A column-shaped aperture closing toward a configurable point in the contour.
	* RGB stays untouched. Only the moving boundary has fractional coverage.
	* This also applies when the image is drawn as an alpha clipping source.
	*/
	var AlphaRevealProcessor = class {
		source;
		reveal;
		top;
		bottom;
		lastValue = -1;
		lastImage;
		constructor(source, reveal) {
			this.source = source;
			this.reveal = reveal;
			this.top = new Int32Array(source.width).fill(source.height);
			this.bottom = new Int32Array(source.width).fill(-1);
			this.lastImage = source;
			for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) if (source.data[(y * source.width + x) * 4 + 3]) {
				this.top[x] = Math.min(this.top[x], y);
				this.bottom[x] = y;
			}
		}
		render(values) {
			const raw = values[this.reveal.parameter] ?? this.reveal.open;
			const normalized = Number.isFinite(raw) ? Math.min(1, Math.max(0, (raw - this.reveal.closed) / (this.reveal.open - this.reveal.closed))) : 1;
			if (normalized === 1) return this.source;
			if (normalized === this.lastValue) return this.lastImage;
			const fraction = normalized ** this.reveal.exponent;
			const data = new Uint8ClampedArray(this.source.data);
			for (let x = 0; x < this.source.width; x++) {
				const span = this.bottom[x] + 1 - this.top[x];
				const start = this.top[x] + span * (1 - fraction) * (this.reveal.anchor ?? 0);
				const cut = start + span * fraction;
				for (let y = 0; y < this.source.height; y++) {
					const i = (y * this.source.width + x) * 4 + 3;
					data[i] = Math.round(data[i] * Math.max(0, Math.min(y + 1, cut) - Math.max(y, start)));
				}
			}
			this.lastValue = normalized;
			return this.lastImage = {
				width: this.source.width,
				height: this.source.height,
				data
			};
		}
	};
	var processors = /* @__PURE__ */ new WeakMap();
	function applyAlphaReveal(source, reveal, values) {
		if (!reveal || !validateAlphaReveal(reveal)) return source;
		const key = JSON.stringify(reveal);
		let entry = processors.get(source);
		if (!entry || entry.key !== key) {
			entry = {
				key,
				processor: new AlphaRevealProcessor(source, reveal)
			};
			processors.set(source, entry);
		}
		return entry.processor.render(values);
	}
	//#endregion
	//#region scripts/evaluation/image-effects.ts
	var effects = /* @__PURE__ */ new Map();
	function clearEffects() {
		effects.clear();
	}
	function effectBuffer(length) {
		if (!Number.isInteger(length) || length <= 0 || length > 64 * 1024 * 1024) throw Error("invalid effect buffer");
		return new Uint8Array(length);
	}
	function registerEffect(id, width, height, bytes, json) {
		const config = JSON.parse(json);
		if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 4096 || height > 4096 || bytes.length !== width * height * 4) throw Error("invalid effect dimensions");
		if (config.tint && validatePartTint(config.tint).length) throw Error("invalid tint");
		if (config.alphaReveal && !validateAlphaReveal(config.alphaReveal)) throw Error("invalid alpha reveal");
		if (config.contourShade && !validateContourShade(config.contourShade)) throw Error("invalid contour shade");
		const data = new Uint8ClampedArray(bytes);
		if (config.tint) {
			const tint = config.tint, color = parseTintColor(tint.color);
			for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) data[i + c] = applyTintChannel(data[i + c], color[c], tint.opacity, tint.mode);
		}
		effects.set(id, {
			source: {
				width,
				height,
				data
			},
			config,
			last: [null, null]
		});
	}
	function renderEffect(id, json, ignoreVisualAlpha) {
		const effect = effects.get(id);
		if (!effect) throw Error("unknown effect");
		const values = JSON.parse(json);
		if (!values || Array.isArray(values) || typeof values !== "object" || Object.values(values).some((v) => typeof v !== "number" || !Number.isFinite(v))) throw Error("invalid effect values");
		const result = applyAlphaReveal(ignoreVisualAlpha ? effect.source : applyContourShade(effect.source, effect.config.contourShade, values), effect.config.alphaReveal, values), slot = ignoreVisualAlpha ? 1 : 0;
		if (effect.last[slot] === result) return null;
		const bgra = new Uint8Array(result.data.length);
		for (let i = 0; i < bgra.length; i += 4) {
			const a = result.data[i + 3];
			bgra[i] = Math.round(result.data[i + 2] * a / 255);
			bgra[i + 1] = Math.round(result.data[i + 1] * a / 255);
			bgra[i + 2] = Math.round(result.data[i] * a / 255);
			bgra[i + 3] = a;
		}
		effect.last[slot] = result;
		return bgra;
	}
	//#endregion
	//#region scripts/evaluation/entry.ts
	var motion;
	function loadMotion(json) {
		if (!rig) throw Error("load a model first");
		const next = parseMotion(JSON.parse(json));
		validateMotionParameters(next, [...definitions.values()]);
		motion = next;
		return JSON.stringify({
			name: next.name,
			duration: next.duration,
			parameterIds: next.tracks.map((t) => t.parameter)
		});
	}
	function motionValues(time) {
		if (!motion) throw Error("no motion");
		if (!Number.isFinite(time) || time < 0 || time > motion.duration) throw Error("motion time outside clip");
		return JSON.stringify(sampleMotion(motion, time));
	}
	var rig;
	var definitions;
	var physics = /* @__PURE__ */ new Map();
	var lastTime;
	var lastPacket;
	var samples = 0;
	var coreMs = 0;
	var geometryMs = 0;
	var samplingMs = 0;
	var projectionMs = 0;
	var validationMs = 0;
	var meshCache = /* @__PURE__ */ new Map();
	function profile() {
		return JSON.stringify({
			samples,
			coreMs: coreMs / Math.max(1, samples - 10),
			geometryMs: geometryMs / Math.max(1, samples - 10),
			samplingMs: samplingMs / Math.max(1, samples - 10),
			projectionMs: projectionMs / Math.max(1, samples - 10),
			validationMs: validationMs / Math.max(1, samples - 10),
			clock: "Date.now milliseconds; approximate"
		});
	}
	function load(json) {
		const next = prepareRigBindingOrder(migrateRigDocument(JSON.parse(json)));
		const defs = parameterDefinitionsForRig$1(next);
		const parameterIds = /* @__PURE__ */ new Set();
		for (const d of defs) {
			if (parameterIds.has(d.id) || ![
				d.min,
				d.max,
				d.default
			].every(Number.isFinite) || d.min > d.max || d.default < d.min || d.default > d.max) throw Error("invalid parameter definition");
			parameterIds.add(d.id);
		}
		if (!Number.isFinite(next.stage.width) || !Number.isFinite(next.stage.height) || next.stage.width <= 0 || next.stage.height <= 0) throw Error("invalid stage");
		const ids = /* @__PURE__ */ new Set();
		for (const part of next.parts) {
			if (ids.has(part.id)) throw Error("duplicate part");
			ids.add(part.id);
		}
		rig = next;
		motion = void 0;
		definitions = new Map(defs.map((d) => [d.id, d]));
		physics = /* @__PURE__ */ new Map();
		lastTime = void 0;
		lastPacket = void 0;
		meshCache.clear();
		samples = coreMs = geometryMs = samplingMs = projectionMs = validationMs = 0;
		initializeTracking(defs);
		return JSON.stringify({
			contract: 1,
			name: rig.name,
			parts: rig.parts.length,
			parameters: defs,
			stage: rig.stage,
			rendererReady: false
		});
	}
	function reset() {
		physics.clear();
		lastTime = void 0;
		lastPacket = void 0;
	}
	function evaluate(json) {
		return advance(json, true);
	}
	function tick(json) {
		return advance(json, false);
	}
	function snapshot() {
		if (!lastPacket) throw Error("no evaluated frame");
		return JSON.stringify(lastPacket);
	}
	var vertexBuffer = /* @__PURE__ */ new Float32Array(0);
	var indexBuffer = /* @__PURE__ */ new Uint32Array(0);
	function renderVertices() {
		return vertexBuffer;
	}
	function renderIndices() {
		return indexBuffer;
	}
	function renderPacket(json) {
		advance(json, false, true);
		const geometry = lastPacket.geometry;
		const vertexCount = geometry.meshes.reduce((n, m) => n + m.vertices.length, 0), indexCount = geometry.meshes.reduce((n, m) => n + m.triangles.length, 0);
		if (vertexCount > 1e6 || indexCount > 3e6) throw Error("render packet budget exceeded");
		if (vertexBuffer.length !== vertexCount * 4) vertexBuffer = new Float32Array(vertexCount * 4);
		if (indexBuffer.length !== indexCount) indexBuffer = new Uint32Array(indexCount);
		let vertexOffset = 0, indexOffset = 0;
		const meshes = geometry.meshes.map((m) => {
			const { vertices, triangles, ...metadata } = m;
			const record = {
				...metadata,
				vertexOffset,
				vertexCount: vertices.length,
				indexOffset,
				indexCount: triangles.length
			};
			for (const v of vertices) {
				vertexBuffer[vertexOffset++] = v.x;
				vertexBuffer[vertexOffset++] = v.y;
				vertexBuffer[vertexOffset++] = v.u;
				vertexBuffer[vertexOffset++] = v.v;
			}
			indexBuffer.set(triangles, indexOffset);
			indexOffset += triangles.length;
			return record;
		});
		return JSON.stringify({
			contract: 1,
			values: lastPacket.values,
			geometry: {
				...geometry,
				meshes
			}
		});
	}
	function advance(json, details, renderMode = false) {
		if (!rig) throw Error("no model");
		const input = JSON.parse(json);
		if (!input || Array.isArray(input) || typeof input !== "object" || Object.keys(input).some((k) => ![
			"time",
			"values",
			"matrix",
			"physics"
		].includes(k))) throw Error("invalid request");
		if (input.physics !== void 0 && typeof input.physics !== "boolean") throw Error("invalid physics flag");
		if (input.values !== void 0 && (!input.values || Array.isArray(input.values) || typeof input.values !== "object")) throw Error("invalid values");
		const time = input.time;
		if (!Number.isFinite(time) || time < 0 || time > 1e9) throw Error("invalid time");
		if (lastTime !== void 0 && time < lastTime) throw Error("time must be monotonic; reset before seeking");
		const values = { ...defaultParameterValues(rig) };
		for (const [id, value] of Object.entries(input.values ?? {})) {
			const d = definitions.get(id);
			if (!d || typeof value !== "number" || !Number.isFinite(value) || value < d.min || value > d.max) throw Error("invalid parameter " + id);
			values[id] = value;
		}
		const matrix = input.matrix ?? {
			a: 1,
			b: 0,
			c: 0,
			d: 1,
			e: 0,
			f: 0
		};
		for (const k of [
			"a",
			"b",
			"c",
			"d",
			"e",
			"f"
		]) if (!Number.isFinite(matrix[k])) throw Error("invalid matrix");
		const nextPhysics = new Map([...physics].map(([key, value]) => [key, { ...value }]));
		const t0 = Date.now();
		const frame = resolveRigFrame(rig, values, matrix, {
			physics: input.physics !== false,
			physicsState: nextPhysics,
			physicsTime: time,
			physicsDt: lastTime === void 0 ? 1 / 60 : Math.min(.05, Math.max(.001, time - lastTime))
		});
		const t1 = Date.now();
		const assets = new Map(rig.assets.map((a) => [a.id, a]));
		const parts = [...rig.parts].sort((a, b) => a.drawOrder - b.drawOrder).map((part) => {
			const state = frame.parts.get(part.id);
			const asset = assets.get(part.assetId);
			const mesh = asset?.width > 0 && asset?.height > 0 ? cachedMesh(part, asset, frame.values) : void 0;
			const localMesh = mesh && part.artMesh?.skinning ? {
				...mesh,
				vertices: applySkinningToVertices(mesh.vertices, part.artMesh.skinning, frame.skinningTransforms)
			} : mesh;
			return {
				id: part.id,
				drawOrder: part.drawOrder,
				state,
				localMesh
			};
		});
		const projectedAt = Date.now();
		const geometry = finalGeometry(rig, frame, matrix, parts);
		const packet = {
			contract: 1,
			meshStage: "local-skinned-pre-warp-and-glue",
			geometry,
			time,
			values: frame.values,
			parts,
			skinningTransforms: [...frame.skinningTransforms],
			physics: {
				partOffsets: [...frame.physics.partOffsets],
				deformerOffsets: [...frame.physics.deformerOffsets],
				parameterOffsets: frame.physics.parameterOffsets
			}
		};
		const t2 = Date.now();
		validateFinitePacket(packet);
		if (renderMode) {
			let vertices = 0, indices = 0;
			for (const mesh of geometry.meshes) {
				vertices += mesh.vertices.length;
				indices += mesh.triangles.length;
				for (const v of mesh.vertices) if (![
					v.x,
					v.y,
					v.u,
					v.v
				].every((n) => Number.isFinite(Math.fround(n)))) throw Error("render float overflow");
			}
			if (vertices > 1e6 || indices > 3e6) throw Error("render packet budget exceeded");
		}
		const result = JSON.stringify(details ? packet : {
			contract: 1,
			time,
			parts: parts.length,
			rendererReady: false
		});
		if (++samples > 10) {
			coreMs += t1 - t0;
			geometryMs += t2 - t1;
			samplingMs += projectedAt - t1;
			projectionMs += t2 - projectedAt;
			validationMs += Date.now() - t2;
		}
		physics = nextPhysics;
		lastTime = time;
		lastPacket = packet;
		return result;
	}
	function cachedMesh(part, asset, values) {
		let entry = meshCache.get(part.id);
		if (!entry) {
			const mesh = part.artMesh, list = (v) => Array.isArray(v) ? v : [];
			entry = {
				parameters: [.../* @__PURE__ */ new Set([
					...list(mesh?.bindings).map((b) => b?.parameter),
					...list(mesh?.multiBindings).flatMap((b) => list(b?.parameters)),
					...list(mesh?.blendShapes).map((b) => b?.parameter)
				])],
				previous: null,
				mesh: void 0,
				resolve: prepareNativeArtMeshResolver(part, asset.width, asset.height)
			};
			meshCache.set(part.id, entry);
		}
		const current = entry.parameters.map((id) => values[id]);
		if (!entry.previous || current.some((v, i) => !Object.is(v, entry.previous[i]))) {
			entry.mesh = entry.resolve(values);
			entry.previous = current;
		}
		return entry.mesh;
	}
	//#endregion
	exports.calibrateTracking = calibrateTracking;
	exports.clearEffects = clearEffects;
	exports.convertFace = convertFace;
	exports.effectBuffer = effectBuffer;
	exports.evaluate = evaluate;
	exports.exportTrackingProfile = exportTrackingProfile;
	exports.load = load;
	exports.loadMotion = loadMotion;
	exports.loadTrackingProfile = loadTrackingProfile;
	exports.mapTracking = mapTracking;
	exports.motionValues = motionValues;
	exports.profile = profile;
	exports.registerEffect = registerEffect;
	exports.renderEffect = renderEffect;
	exports.renderIndices = renderIndices;
	exports.renderPacket = renderPacket;
	exports.renderVertices = renderVertices;
	exports.reset = reset;
	exports.resetTracking = resetTracking;
	exports.snapshot = snapshot;
	exports.tick = tick;
	return exports;
})({});
