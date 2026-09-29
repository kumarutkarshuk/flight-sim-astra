import { test, expect } from "@playwright/test";
import * as THREE from "three";
import { splitCoast } from "../lib/simulator/coast";

test("shore triangles partition land and sea without overlapping surfaces or gaps", () => {
  const source = new THREE.BufferGeometry();
  source.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, -2, 0, 0, 2, 10, 10, 2, 0], 3),
  );
  source.setAttribute(
    "color",
    new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3),
  );
  source.computeVertexNormals();
  const { ground, sea } = splitCoast(source);
  const area = (geometry: THREE.BufferGeometry) => {
    const p = geometry.getAttribute("position");
    let sum = 0;
    for (let i = 0; i < p.count; i += 3)
      sum +=
        Math.abs(
          (p.getX(i + 1) - p.getX(i)) * (p.getZ(i + 2) - p.getZ(i)) -
            (p.getX(i + 2) - p.getX(i)) * (p.getZ(i + 1) - p.getZ(i)),
        ) / 2;
    return sum;
  };
  expect(area(ground)).toBeCloseTo(37.5);
  expect(area(sea)).toBeCloseTo(12.5);
  const shore = (geometry: THREE.BufferGeometry) => {
    const p = geometry.getAttribute("position");
    return Array.from({ length: p.count }, (_, i) => [
      p.getX(i),
      p.getY(i),
      p.getZ(i),
    ]).filter((v) => v[1] === 0);
  };
  expect(shore(ground)).toContainEqual([0, 0, 5]);
  expect(shore(ground)).toContainEqual([5, 0, 0]);
  expect(shore(sea)).toContainEqual([0, 0, 5]);
  expect(shore(sea)).toContainEqual([5, 0, 0]);
  for (let i = 0; i < ground.getAttribute("position").count; i++)
    expect(ground.getAttribute("position").getY(i)).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < sea.getAttribute("position").count; i++)
    expect(sea.getAttribute("position").getY(i)).toBe(0);
  source.dispose();
  ground.dispose();
  sea.dispose();
});
