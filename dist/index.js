"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const CSVExport_1 = require("./CSVExport");
const SimpleJSONTransform_1 = require("./SimpleJSONTransform");
const EconomicTransform_1 = require("./EconomicTransform");
const ShopifyTransform_1 = require("./ShopifyTransform");
const SkipExport_1 = require("./SkipExport");
exports.default = {
    csv: CSVExport_1.CSVExport,
    simpleJSON: SimpleJSONTransform_1.SimpleJSONTransform,
    economic: EconomicTransform_1.EconomicTransform,
    shopify: ShopifyTransform_1.ShopifyTransform,
    SkipExport: SkipExport_1.SkipExport
};
