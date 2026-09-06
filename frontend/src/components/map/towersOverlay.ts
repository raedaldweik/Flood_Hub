/**
 * Risk-lit towers on the vector map: OpenStreetMap footprints extruded with three.js inside a
 * google.maps.WebGLOverlayView, so they share the basemap's camera and depth buffer and sit among
 * Google's own 3D buildings instead of floating over them.
 *
 * Coordinates: Google hands us a matrix that maps a local metre frame at ANCHOR (x east, y north,
 * z up) to clip space; every footprint is converted to that frame once, at load.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { BuildingFeature, Band } from "@/lib/api";

const M_PER_DEG_LAT = 111_320;

function material(hex: number, emissive: number, glow: number, opacity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: hex,
    emissive,
    emissiveIntensity: glow,
    transparent: opacity < 1,
    opacity,
    roughness: 0.55,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
}

/**
 * Normal zones: solid slate buildings with a faint cyan lift, so they read as part of the dark
 * basemap rather than as boxes on top of it. From the yellow band up the zone's risk colour
 * takes over and the tower glows.
 */
const MATERIALS: Record<Band, THREE.MeshStandardMaterial> = {
  green: material(0x3b4a5e, 0x0ea5e9, 0.08),
  yellow: material(0xca9a06, 0xeab308, 0.45),
  orange: material(0xd8641a, 0xf97316, 0.5),
  red: material(0xd33c3c, 0xef4444, 0.6),
};
const OUTSIDE = material(0x334155, 0x000000, 0); // towers that stand in no zone

export interface TowersOverlay {
  overlay: google.maps.WebGLOverlayView;
  /** Replace the tower set (called once buildings arrive). */
  setBuildings: (features: BuildingFeature[]) => void;
  /** Recolour by zone band; cheap, only touches towers whose band changed. */
  paint: (bandOfZone: (zoneId: string) => Band) => void;
  setVisible: (on: boolean) => void;
  dispose: () => void;
}

export function createTowersOverlay(lib: google.maps.MapsLibrary, anchor: { lat: number; lng: number }): TowersOverlay {
  const overlay = new lib.WebGLOverlayView();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const group = new THREE.Group();
  scene.add(group);
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 1.15);
  sun.position.set(-700, -900, 1500);
  scene.add(sun);

  let renderer: THREE.WebGLRenderer | null = null;
  const towers: { mesh: THREE.Mesh; zone: string | null; band: Band | null }[] = [];
  let edges: THREE.LineSegments | null = null;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((anchor.lat * Math.PI) / 180);

  overlay.onAdd = () => {};
  overlay.onContextRestored = ({ gl }) => {
    renderer = new THREE.WebGLRenderer({
      canvas: gl.canvas as HTMLCanvasElement,
      context: gl as WebGL2RenderingContext,
      ...gl.getContextAttributes(),
    });
    renderer.autoClear = false;
  };
  overlay.onContextLost = () => {
    renderer?.dispose();
    renderer = null;
  };
  overlay.onDraw = ({ transformer }) => {
    if (!renderer || !group.visible) return;
    const m = transformer.fromLatLngAltitude({ lat: anchor.lat, lng: anchor.lng, altitude: 0 });
    camera.projectionMatrix = new THREE.Matrix4().fromArray(m);
    renderer.render(scene, camera);
    renderer.resetState();
  };
  overlay.onRemove = () => {
    clear();
  };

  function clear() {
    for (const t of towers) {
      group.remove(t.mesh);
      t.mesh.geometry.dispose();
    }
    towers.length = 0;
    if (edges) {
      group.remove(edges);
      edges.geometry.dispose();
      edges = null;
    }
  }

  function setBuildings(features: BuildingFeature[]) {
    clear();
    const edgeGeoms: THREE.BufferGeometry[] = [];
    for (const f of features) {
      const ring = f.geometry.coordinates[0];
      if (!ring || ring.length < 4) continue;
      const pts = ring.slice(0, -1).map(([lng, lat]) => new THREE.Vector2((lng - anchor.lng) * mPerDegLng, (lat - anchor.lat) * M_PER_DEG_LAT));
      const shape = new THREE.Shape(pts);
      const geom = new THREE.ExtrudeGeometry(shape, { depth: f.properties.height_m, bevelEnabled: false });
      const zone = f.properties.zone_id;
      const mesh = new THREE.Mesh(geom, zone ? MATERIALS.green : OUTSIDE);
      group.add(mesh);
      towers.push({ mesh, zone, band: zone ? "green" : null });
      edgeGeoms.push(new THREE.EdgesGeometry(geom, 20));
    }
    if (edgeGeoms.length) {
      const merged = mergeGeometries(edgeGeoms, false);
      for (const g of edgeGeoms) g.dispose();
      if (merged) {
        edges = new THREE.LineSegments(merged, new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.22 }));
        group.add(edges);
      }
    }
    overlay.requestRedraw();
  }

  function paint(bandOfZone: (zoneId: string) => Band) {
    let changed = false;
    for (const t of towers) {
      if (!t.zone) continue;
      const band = bandOfZone(t.zone);
      if (band === t.band) continue;
      t.band = band;
      t.mesh.material = MATERIALS[band];
      changed = true;
    }
    if (changed) overlay.requestRedraw();
  }

  function setVisible(on: boolean) {
    group.visible = on;
    overlay.requestRedraw();
  }

  function dispose() {
    clear();
    overlay.setMap(null);
    renderer?.dispose();
    renderer = null;
  }

  return { overlay, setBuildings, paint, setVisible, dispose };
}
