import { CSVExport } from "./CSVExport"
import { SimpleJSONTransform } from "./SimpleJSONTransform"
import { MagentoKleanTransform } from "./MagentoKleanTransform"
import { EconomicTransform, SkipExport } from "./EconomicTransform"

export default {
    csv: CSVExport,
    simpleJSON: SimpleJSONTransform,
    magentoKlean: MagentoKleanTransform,
    economic: EconomicTransform,
    SkipExport: SkipExport
}