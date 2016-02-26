import ClipperLib from 'clipper-lib';

const CLIPPER = new ClipperLib.Clipper();

export default class Shape {
  constructor(paths = [], closed = true, capitalConversion = false) {
    this.paths = capitalConversion ? paths.map(mapLowerToCapital) : paths;
    this.closed = closed;
  }

  _clip(clipShape, type) {
    const solution = new ClipperLib.PolyTree();

    CLIPPER.Clear();
    CLIPPER.AddPaths(this.paths, ClipperLib.PolyType.ptSubject, this.closed);
    CLIPPER.AddPaths(clipShape.paths, ClipperLib.PolyType.ptClip, clipShape.closed);
    CLIPPER.Execute(type, solution);

    let newShape;
    if (this.closed) {
      newShape = ClipperLib.Clipper.ClosedPathsFromPolyTree(solution);
    } else {
      newShape = ClipperLib.Clipper.OpenPathsFromPolyTree(solution);
    }

    return new Shape(newShape, this.closed);
  }

  union(clipShape) {
    return this._clip(clipShape, ClipperLib.ClipType.ctUnion);
  }

  difference(clipShape) {
    return this._clip(clipShape, ClipperLib.ClipType.ctDifference);
  }

  intersect(clipShape) {
    return this._clip(clipShape, ClipperLib.ClipType.ctIntersection);
  }

  xor(clipShape) {
    return this._clip(clipShape, ClipperLib.ClipType.ctXor);
  }

  offset(offset, options) {
    const {
      jointType = 'jtSquare',
      endType = 'etClosedPolygon',
      miterLimit = 2.0,
      roundPrecision = 0.25
    } = options;

    const offsetPaths = new ClipperLib.Paths();
    const clipperOffset = new ClipperLib.ClipperOffset(miterLimit, roundPrecision);
    clipperOffset.AddPaths(this.paths, ClipperLib.JoinType[jointType], ClipperLib.EndType[endType]);
    clipperOffset.Execute(offsetPaths, offset);

    return new Shape(offsetPaths, true);
  }

  scaleUp(factor) {
    ClipperLib.JS.ScaleUpPaths(this.paths, factor);

    return this;
  }

  scaleDown(factor) {
    ClipperLib.JS.ScaleDownPaths(this.paths, factor);

    return this;
  }

  lastPoint() {
    if (this.paths.length === 0) {
      return;
    }

    const lastPath = this.paths[this.paths.length - 1];
    return this.closed ? lastPath[0] : lastPath[lastPath.length - 1];
  }

  areas() {
    const areas = [];

    for (let i = 0; i < this.paths.length; i ++) {
      const area = this.area(i);
      areas.push(area);
    }

    return areas;
  }

  area(index) {
    const path = this.paths[index];
    const area = ClipperLib.Clipper.Area(path);
    return area;
  }

  totalArea() {
    return this.areas().reduce((a, b) => a + b);
  }

  reverse() {
    for (const path of this.paths) {
      path.reverse();
    }

    return this;
  }

  tresholdArea(minArea) {
    // code not tested yet
    for (const path of [...this.paths]) {
      const area = Math.abs(ClipperLib.Clipper.Area(shape));

      if (area < minArea) {
        const index = this.paths.indexOf(path);
        this.splice(index, 1);
      }
    }
  }

  join(shape) {
    this.paths.join(shape.paths);

    return this;
  }

  clone() {
    return new Shape(ClipperLib.JS.Clone(this.paths), this.closed);
  }

  shapeBounds() {
    const bounds = ClipperLib.JS.BoundsOfPaths(this.paths);

    bounds.width = bounds.right - bounds.left;
    bounds.height = bounds.bottom - bounds.top;
    bounds.size = bounds.width * bounds.height;

    return bounds;
  }

  pathBounds(index) {
    const path = this.paths[index];

    const bounds = ClipperLib.JS.BoundsOfPath(path);

    bounds.width = bounds.right - bounds.left;
    bounds.height = bounds.bottom - bounds.top;
    bounds.size = bounds.width * bounds.height;

    return bounds;
  }

  clean(cleanDelta) {
    return new Shape(ClipperLib.Clipper.CleanPolygons(this.paths, cleanDelta), this.closed);
  }

  orientation(index) {
    const path = this.paths[index];
    return ClipperLib.Clipper.Orientation(path);
  }

  pointInShape(point) {
    for (let i = 0; i < this.paths.length; i ++) {
      const pointInPath = this.pointInPath(i, point);
      const orientation = this.orientation(i);

      if ((!pointInPath && orientation) || (pointInPath && !orientation)) {
        return false;
      }
    }

    return true;
  }

  pointInPath(index, point) {
    const path = this.paths[index];
    const intPoint = { X: Math.round(point.X), Y: Math.round(point.Y) };

    return ClipperLib.Clipper.PointInPolygon(intPoint, path) > 0;
  }

  checkOrientation() {
    if (!this.closed) {
      return this;
    }

    let maxSize = 0;
    let indexMax;

    for (let i = 0; i < this.paths.length; i ++) {
      const { size } = this.pathBounds(i);

      if (size > maxSize) {
        maxSize = size;
        indexMax = i;
      }
    }

    const orientation = this.orientation(i);
    if (!orientation) {
      this.reverse();
    }
  }

  removeOverlap() {
    if (this.closed) {
      const shape = ClipperLib.Clipper.SimplifyPolygons(this.paths, ClipperLib.PolyFillType.pftNonZero);
      return new Shape(shape, true);
    } else {
      return this;
    }
  }

  seperateShapes() {
    const shapes = [];

    if (!this.closed) {
      for (const path of this.paths) {
        shapes.push(new Shape([path], false));
      }
    } else {
      const map = new WeakMap();
      const outlines = [];
      const holes = [];

      for (let i = 0; i < this.paths.length; i ++) {
        const path = this.paths[i];
        const orientation = this.orientation(i);

        if (orientation) {
          const area = this.area(i);
          map.set(path, { area, index: i });
          outlines.push(path);
        } else {
          holes.push(path);
        }
      }

      outlines.sort((a, b) => {
        return map.get(a).area > map.get(b).area
      });

      for (const outline of outlines) {
        const shape = [outline];

        const { index } = map.get(outline);

        for (const hole of [...holes]) {
          const pointInHole = this.pointInPath(index, hole[0]);
          if (pointInHole) {
            shape.push(hole);

            const index = holes.indexOf(hole);
            holes.splice(index, 1);
          }
        }

        shapes.push(new Shape(shape, true));
      }
    }

    return shapes;
  }

  mapToLower() {
    return this.paths.map(mapCapitalToLower);
  }
}

function mapCapitalToLower(paths) {
  return paths.map(({ X, Y }) => ({ x: X, y: Y }));
}

function mapLowerToCapital(paths) {
  return paths.map(({ x, y }) => ({ X: x, Y: y }));
}
