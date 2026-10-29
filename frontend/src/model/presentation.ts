// Category presentations and their edits. This module has no database,
// storage, rendering, or instance-data dependency.
export type ObjectDef = { id: string; label: string; kind: "entity" | "type" };
export type ArrowDef = {
  id: string;
  label: string;
  source: string;
  target: string;
};
export type Path = {
  source: string;
  arrows: string[];
  constant?: { sort: string; value: string | null };
};
export type Equation = {
  id: string;
  left: Path;
  right: Path;
  origin?: "binding";
};
export type TypeSide = {
  id: string;
  sorts: { id: string; carrier: string; nullable: boolean }[];
};
export type Presentation = {
  typeside?: TypeSide;
  objects: ObjectDef[];
  arrows: ArrowDef[];
  equations: Equation[];
};
export type ElementaryEdit =
  | { kind: "add_object"; object: ObjectDef }
  | { kind: "drop_object"; id: string }
  | { kind: "add_arrow"; arrow: ArrowDef }
  | { kind: "drop_arrow"; id: string }
  | { kind: "add_equation"; equation: Equation }
  | { kind: "drop_equation"; id: string }
  | { kind: "rename"; target: "object" | "arrow"; id: string; label: string };

export const samePath = (a: Path, b: Path) =>
  a.source === b.source &&
  a.arrows.length === b.arrows.length &&
  a.arrows.every((id, i) => id === b.arrows[i]) &&
  JSON.stringify(a.constant ?? null) === JSON.stringify(b.constant ?? null);
export const qualifiedArrowLabel = (p: Presentation, id: string) => {
  const arrow = p.arrows.find((a) => a.id === id);
  if (!arrow) return "(removed arrow)";
  return `${p.objects.find((o) => o.id === arrow.source)?.label ?? "(removed object)"}.${arrow.label}`;
};
export const pathLabel = (p: Presentation, path: Path) =>
  path.constant
    ? path.constant.value === null
      ? "NULL"
      : JSON.stringify(path.constant.value)
    : path.arrows.map((id) => qualifiedArrowLabel(p, id)).join(" › ") ||
      `id(${p.objects.find((o) => o.id === path.source)?.label ?? "(removed object)"})`;
export function endpoint(presentation: Presentation, path: Path): string {
  if (!presentation.objects.some((o) => o.id === path.source))
    throw new Error("A path starts at an unknown object.");
  let current = path.source;
  for (const id of path.arrows) {
    const arrow = presentation.arrows.find((a) => a.id === id);
    if (!arrow || arrow.source !== current)
      throw new Error("Path arrows do not compose.");
    current = arrow.target;
  }
  if (path.constant) {
    const sort = presentation.typeside?.sorts.find(
      (s) => s.id === path.constant!.sort,
    );
    if (!sort || (path.constant.value === null && !sort.nullable))
      throw new Error(
        "A constant term must belong to the fixed scalar typeside.",
      );
    if (
      path.constant.value !== null &&
      sort.carrier === "signed-int64" &&
      (!/^-?\d+$/.test(path.constant.value) ||
        BigInt(path.constant.value) < -(1n << 63n) ||
        BigInt(path.constant.value) >= 1n << 63n)
    )
      throw new Error("The integer constant is outside its scalar domain.");
    return sort.id;
  }
  return current;
}
export function then(presentation: Presentation, a: Path, b: Path): Path {
  if (endpoint(presentation, a) !== b.source)
    throw new Error("Path endpoints do not match.");
  return {
    source: a.source,
    arrows: [...a.arrows, ...b.arrows],
    ...((b.constant ?? a.constant)
      ? { constant: b.constant ?? a.constant }
      : {}),
  };
}
export function validatePresentation(p: Presentation) {
  if (p.typeside) {
    const sorts = p.typeside.sorts;
    if (new Set(sorts.map((s) => s.id)).size !== sorts.length)
      throw new Error("Typeside sorts must be unique.");
    if (
      sorts.some(
        (s) => !p.objects.some((o) => o.id === s.id && o.kind === "type"),
      ) ||
      p.objects.some(
        (o) => o.kind === "type" && !sorts.some((s) => s.id === o.id),
      )
    )
      throw new Error(
        "A typed presentation must contain exactly its fixed typeside sorts.",
      );
    if (
      p.arrows.some(
        (a) => p.objects.find((o) => o.id === a.source)?.kind === "type",
      )
    )
      throw new Error(
        "The fixed scalar typeside has no editable outgoing generators.",
      );
  }
  for (const collection of [p.objects, p.arrows, p.equations]) {
    if (
      collection.some((x) => !x.id) ||
      new Set(collection.map((x) => x.id)).size !== collection.length
    )
      throw new Error(
        "Presentation IDs must be nonempty and unique within their kind.",
      );
  }
  for (const a of p.arrows) {
    if (
      !p.objects.some((o) => o.id === a.source) ||
      !p.objects.some((o) => o.id === a.target)
    )
      throw new Error("An arrow has an unknown endpoint.");
  }
  for (const e of p.equations) {
    if (
      e.left.source !== e.right.source ||
      endpoint(p, e.left) !== endpoint(p, e.right)
    )
      throw new Error("An equation must compare parallel paths.");
  }
}
export function applyEdits(
  before: Presentation,
  edits: ElementaryEdit[],
): Presentation {
  const p = structuredClone(before);
  validatePresentation(p);
  for (const edit of edits) {
    switch (edit.kind) {
      case "add_object":
        p.objects.push(structuredClone(edit.object));
        break;
      case "drop_object": {
        if (!p.objects.some((o) => o.id === edit.id))
          throw new Error("The object does not exist.");
        if (
          p.arrows.some((a) => a.source === edit.id || a.target === edit.id) ||
          p.equations.some(
            (e) => e.left.source === edit.id || e.right.source === edit.id,
          )
        )
          throw new Error(
            "Remove incident arrows and equations before the object.",
          );
        p.objects = p.objects.filter((o) => o.id !== edit.id);
        break;
      }
      case "add_arrow":
        p.arrows.push(structuredClone(edit.arrow));
        break;
      case "drop_arrow": {
        if (!p.arrows.some((a) => a.id === edit.id))
          throw new Error("The arrow does not exist.");
        if (
          p.equations.some(
            (e) =>
              e.left.arrows.includes(edit.id) ||
              e.right.arrows.includes(edit.id),
          )
        )
          throw new Error("Remove equations using this arrow first.");
        p.arrows = p.arrows.filter((a) => a.id !== edit.id);
        break;
      }
      case "add_equation":
        p.equations.push(structuredClone(edit.equation));
        break;
      case "drop_equation": {
        if (!p.equations.some((e) => e.id === edit.id))
          throw new Error("The equation does not exist.");
        p.equations = p.equations.filter((e) => e.id !== edit.id);
        break;
      }
      case "rename": {
        const value = (edit.target === "object" ? p.objects : p.arrows).find(
          (x) => x.id === edit.id,
        );
        if (!value) throw new Error("The named generator does not exist.");
        value.label = edit.label;
        break;
      }
    }
    validatePresentation(p);
  }
  return p;
}

// Explicit equality evidence keeps checking decidable without inventing a
// general word-problem solver. Constructors and composition produce this evidence.
export type EqualityProof =
  | { kind: "refl"; path: Path }
  | { kind: "relation"; id: string }
  | { kind: "symmetry"; proof: EqualityProof }
  | { kind: "transitivity"; first: EqualityProof; second: EqualityProof }
  | { kind: "context"; prefix: Path; proof: EqualityProof; suffix: Path };
function prove(p: Presentation, proof: EqualityProof): [Path, Path] {
  switch (proof.kind) {
    case "refl":
      endpoint(p, proof.path);
      return [proof.path, proof.path];
    case "relation": {
      const e = p.equations.find((e) => e.id === proof.id);
      if (!e) throw new Error("Unknown equation evidence.");
      return [e.left, e.right];
    }
    case "symmetry": {
      const [a, b] = prove(p, proof.proof);
      return [b, a];
    }
    case "transitivity": {
      const [a, b] = prove(p, proof.first),
        [c, d] = prove(p, proof.second);
      if (!samePath(b, c))
        throw new Error("Equality evidence does not compose.");
      return [a, d];
    }
    case "context": {
      const [a, b] = prove(p, proof.proof);
      return [
        then(p, then(p, proof.prefix, a), proof.suffix),
        then(p, then(p, proof.prefix, b), proof.suffix),
      ];
    }
  }
}
export type Mapping = {
  source: Presentation;
  target: Presentation;
  objects: Record<string, string>;
  arrows: Record<string, Path>;
  proofs: Record<string, EqualityProof>;
};
export function mapPath(mapping: Mapping, path: Path): Path {
  endpoint(mapping.source, path);
  let result: Path = { source: mapping.objects[path.source], arrows: [] };
  for (const id of path.arrows) {
    const image = mapping.arrows[id];
    if (!image) throw new Error("A generating arrow has no image.");
    result = then(mapping.target, result, image);
  }
  if (path.constant)
    result = { ...result, constant: structuredClone(path.constant) };
  return result;
}
export function checkedMapping(
  input: Omit<Mapping, "proofs"> & { proofs?: Mapping["proofs"] },
): Mapping {
  const mapping: Mapping = { ...input, proofs: { ...input.proofs } };
  validatePresentation(mapping.source);
  validatePresentation(mapping.target);
  if (
    JSON.stringify(mapping.source.typeside ?? null) !==
    JSON.stringify(mapping.target.typeside ?? null)
  )
    throw new Error("Schema mappings must use the same fixed typeside.");
  for (const sort of mapping.source.typeside?.sorts ?? [])
    if (mapping.objects[sort.id] !== sort.id)
      throw new Error(
        "Schema mappings must be identity on the fixed typeside.",
      );
  for (const object of mapping.source.objects) {
    const target = mapping.target.objects.find(
      (o) => o.id === mapping.objects[object.id],
    );
    if (!target || target.kind !== object.kind)
      throw new Error("An object has no compatible image.");
  }
  for (const arrow of mapping.source.arrows) {
    const image = mapping.arrows[arrow.id];
    if (
      !image ||
      image.source !== mapping.objects[arrow.source] ||
      endpoint(mapping.target, image) !== mapping.objects[arrow.target]
    )
      throw new Error("An arrow image has incompatible endpoints.");
  }
  for (const equation of mapping.source.equations) {
    const left = mapPath(mapping, equation.left),
      right = mapPath(mapping, equation.right);
    if (!mapping.proofs[equation.id]) {
      if (samePath(left, right))
        mapping.proofs[equation.id] = { kind: "refl", path: left };
      else {
        const relation = mapping.target.equations.find(
          (e) =>
            (samePath(e.left, left) && samePath(e.right, right)) ||
            (samePath(e.right, left) && samePath(e.left, right)),
        );
        if (!relation)
          throw new Error(
            "A mapping needs evidence that it preserves an equation.",
          );
        const proof: EqualityProof = { kind: "relation", id: relation.id };
        mapping.proofs[equation.id] = samePath(relation.left, left)
          ? proof
          : { kind: "symmetry", proof };
      }
    }
    const [a, b] = prove(mapping.target, mapping.proofs[equation.id]);
    if (!samePath(a, left) || !samePath(b, right))
      throw new Error("Equation evidence proves different paths.");
  }
  return mapping;
}
export function identityMapping(
  source: Presentation,
  target: Presentation = source,
): Mapping {
  return checkedMapping({
    source,
    target,
    objects: Object.fromEntries(source.objects.map((o) => [o.id, o.id])),
    arrows: Object.fromEntries(
      source.arrows.map((a) => [a.id, { source: a.source, arrows: [a.id] }]),
    ),
  });
}
export function samePresentation(a: Presentation, b: Presentation): boolean {
  const shape = (p: Presentation) =>
    JSON.stringify([
      p.typeside ?? null,
      p.objects.map((o) => [o.id, o.kind]).sort(),
      p.arrows.map((a) => [a.id, a.source, a.target]).sort(),
      p.equations
        .map((e) => [
          e.id,
          e.left.source,
          e.left.arrows,
          e.right.arrows,
          e.left.constant ?? null,
          e.right.constant ?? null,
        ])
        .sort(),
    ]);
  return shape(a) === shape(b);
}
function transportProof(mapping: Mapping, proof: EqualityProof): EqualityProof {
  switch (proof.kind) {
    case "refl":
      return { kind: "refl", path: mapPath(mapping, proof.path) };
    case "relation":
      return mapping.proofs[proof.id];
    case "symmetry":
      return { kind: "symmetry", proof: transportProof(mapping, proof.proof) };
    case "transitivity":
      return {
        kind: "transitivity",
        first: transportProof(mapping, proof.first),
        second: transportProof(mapping, proof.second),
      };
    case "context":
      return {
        kind: "context",
        prefix: mapPath(mapping, proof.prefix),
        proof: transportProof(mapping, proof.proof),
        suffix: mapPath(mapping, proof.suffix),
      };
  }
}
export function composeMappings(first: Mapping, second: Mapping): Mapping {
  if (!samePresentation(first.target, second.source))
    throw new Error("Mapping endpoints do not compose.");
  return checkedMapping({
    source: first.source,
    target: second.target,
    objects: Object.fromEntries(
      Object.entries(first.objects).map(([id, image]) => [
        id,
        second.objects[image],
      ]),
    ),
    arrows: Object.fromEntries(
      Object.entries(first.arrows).map(([id, image]) => [
        id,
        mapPath(second, image),
      ]),
    ),
    proofs: Object.fromEntries(
      Object.entries(first.proofs).map(([id, proof]) => [
        id,
        transportProof(second, proof),
      ]),
    ),
  });
}
