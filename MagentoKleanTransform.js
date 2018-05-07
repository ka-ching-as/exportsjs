const md5 = require('blueimp-md5');

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
    let jsonString = JSON.stringify(output);
    let hash = md5(jsonString + this.configuration.salt);
    output["hash"] = hash;
    return output;
  }
}

module.exports = MagentoKleanTransform;
