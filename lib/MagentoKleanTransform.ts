export class MagentoKleanTransform {
    data: any
    configuration: any
    constructor(configuration: any, data: any) {
        this.data = data
        this.configuration = configuration
    }

    export(): any {
        var output = {
            sales: this.data,
            key: this.configuration.key || "",
            storeId: this.configuration.storeId || 1,
            websiteId: this.configuration.websiteId || 1
        }
        return output
    }
}
