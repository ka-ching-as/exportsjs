import { CSVExport } from "./CSVExport"
import { SimpleJSONTransform } from "./SimpleJSONTransform"
import { EconomicTransform, SkipExport } from "./EconomicTransform"

export default {
    csv: CSVExport,
    simpleJSON: SimpleJSONTransform,
    economic: EconomicTransform,
    SkipExport: SkipExport
}