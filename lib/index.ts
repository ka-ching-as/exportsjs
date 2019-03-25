import { CSVExport } from "./CSVExport"
import { SimpleJSONTransform } from "./SimpleJSONTransform"
import { MagentoKleanTransform } from "./MagentoKleanTransform"
import { EconomicTransform } from "./EconomicTransform"

export default {
    csv: CSVExport,
    simpleJSON: SimpleJSONTransform,
    magentoKlean: MagentoKleanTransform,
    economic: EconomicTransform
}