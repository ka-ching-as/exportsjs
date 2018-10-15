"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const CSVExport_1 = require("./CSVExport");
const SimpleJSONTransform_1 = require("./SimpleJSONTransform");
const MagentoKleanTransform_1 = require("./MagentoKleanTransform");
exports.default = {
    csv: CSVExport_1.CSVExport,
    simpleJson: SimpleJSONTransform_1.SimpleJSONTransform,
    magentoKlean: MagentoKleanTransform_1.MagentoKleanTransform
};
