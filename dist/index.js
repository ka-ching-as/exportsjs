"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const CSVExport_1 = require("./CSVExport");
const SimpleJSONTransform_1 = require("./SimpleJSONTransform");
const MagentoKleanTransform_1 = require("./MagentoKleanTransform");
const EconomicTransform_1 = require("./EconomicTransform");
exports.default = {
    csv: CSVExport_1.CSVExport,
    simpleJSON: SimpleJSONTransform_1.SimpleJSONTransform,
    magentoKlean: MagentoKleanTransform_1.MagentoKleanTransform,
    economic: EconomicTransform_1.EconomicTransform
};
