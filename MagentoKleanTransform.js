const numeral = require('numeral');

class MagentoKleanTransform {
    constructor(configuration, data) {
        this.data = data;
        this.configuration = configuration;
    }

    export() {
        var output = {
            sales: this.data,
            key: this.configuration.key || "",
            storeId: this.configuration.storeId || 1,
            websiteId: this.configuration.websiteId || 1
        };
        return output;
    }
}

module.exports = MagentoKleanTransform;
