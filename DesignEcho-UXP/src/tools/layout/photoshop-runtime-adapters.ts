type PhotoshopElementPlacementName = 'PLACEBEFORE' | 'PLACEAFTER' | 'PLACEINSIDE';

type PhotoshopElementPlacementConstants = {
    ElementPlacement?: Partial<Record<PhotoshopElementPlacementName, unknown>>;
};

type PhotoshopAppUiMethods = {
    bringToFront?: () => void;
    updateUI?: () => void | Promise<void>;
};

export function getPhotoshopElementPlacement(
    constants: unknown,
    name: PhotoshopElementPlacementName,
    context: string
): unknown {
    const placement = (constants as PhotoshopElementPlacementConstants | null | undefined)?.ElementPlacement?.[name];
    if (!placement) {
        throw new Error(`${context}: current Photoshop UXP environment does not expose ElementPlacement.${name}.`);
    }
    return placement;
}

export function getPhotoshopAppUiMethods(app: unknown): PhotoshopAppUiMethods {
    return app as PhotoshopAppUiMethods;
}
