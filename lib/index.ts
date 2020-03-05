import { CSVExport } from "./CSVExport"
import { SimpleJSONTransform } from "./SimpleJSONTransform"
import { EconomicTransform } from "./EconomicTransform"
import { ElasticSearchTransform } from "./ElasticSearchTransform"
import { ShopifyTransform } from "./ShopifyTransform"
import { SkipExport } from "./SkipExport"

export default {
    csv: CSVExport,
    simpleJSON: SimpleJSONTransform,
    economic: EconomicTransform,
    elastic: ElasticSearchTransform,
    shopify: ShopifyTransform,
    SkipExport: SkipExport
}