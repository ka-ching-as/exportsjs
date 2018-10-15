export declare class SimpleJSONTransform {
    data: any;
    configuration: any;
    constructor(configuration: any, data: any);
    export(): any;
    valueFromPath(path: string, obj: any): string;
    parametrizeString(string: string, object: any): string;
}
