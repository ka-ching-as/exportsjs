import { CSVExport } from "./CSVExport"
import { SimpleJSONTransform } from "./SimpleJSONTransform"
import { EconomicTransform } from "./EconomicTransform"
import { ShopifyTransform } from "./ShopifyTransform"
import { SkipExport } from "./SkipExport"

export default {
    csv: CSVExport,
    simpleJSON: SimpleJSONTransform,
    economic: EconomicTransform,
    shopify: ShopifyTransform,
    SkipExport: SkipExport
}