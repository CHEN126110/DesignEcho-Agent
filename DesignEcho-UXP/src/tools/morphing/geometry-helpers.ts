import { BoundingBox, PathData, Point2D } from './types';

export function readUnitValue(value: any, fallback: number = 0): number {
    if (typeof value === 'number') {
        return value;
    }

    if (value && typeof value._value === 'number') {
        return value._value;
    }

    return fallback;
}

export function readPathAxisValue(container: any, axis: 'horizontal' | 'vertical', fallbackAxis: 'x' | 'y'): number {
    if (!container || typeof container !== 'object') {
        return 0;
    }

    const axisNode = container[axis];
    if (axisNode && typeof axisNode._value === 'number') {
        return axisNode._value;
    }

    return typeof container[fallbackAxis] === 'number' ? container[fallbackAxis] : 0;
}

export function buildBoundingBoxFromBounds(bounds: any): BoundingBox | null {
    if (!bounds) {
        return null;
    }

    const left = readUnitValue(bounds.left, 0);
    const top = readUnitValue(bounds.top, 0);
    const right = readUnitValue(bounds.right, 0);
    const bottom = readUnitValue(bounds.bottom, 0);

    return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
    };
}

export function getBoundingBoxCornerPoints(boundingBox: BoundingBox): Point2D[] {
    return [
        { x: boundingBox.x, y: boundingBox.y },
        { x: boundingBox.x + boundingBox.width, y: boundingBox.y },
        { x: boundingBox.x + boundingBox.width, y: boundingBox.y + boundingBox.height },
        { x: boundingBox.x, y: boundingBox.y + boundingBox.height }
    ];
}

export function createRectanglePathData(boundingBox: BoundingBox): PathData {
    return {
        closed: true,
        points: getBoundingBoxCornerPoints(boundingBox).map((point) => ({
            anchor: point
        }))
    };
}
