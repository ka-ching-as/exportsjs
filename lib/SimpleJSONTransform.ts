import * as numeral from "numeral"

export class SimpleJSONTransform {
    data: any
    configuration: any
    
    constructor(configuration: any, data: any) {
        this.data = data
        this.configuration = configuration
    }

    export() {
        const body: any = {}
        for (const key in this.configuration) {
            const expression = this.configuration[key]
            const value = this.parametrizeString(expression, this.data)
            if (value !== "#SKIP_THIS#") {
                body[key] = value
            }
        }
        return body
    }

    valueFromPath(path: string, obj: any): string {
        return path.split(".").reduce((o, i) => { if (o) { return o[i] } else { return "undefined" } }, obj)
    }

    parametrizeString(string: string, object: any): string {
        return string.replace(/({.*?})/g, j => {
            const removedBraces = j.substr(1).slice(0, -1)
            const components = removedBraces.split("|")
            const path = components[0]
            const value = this.valueFromPath(path, object)
            if (value.constructor === Number) {
                return numeral(value).format()
            } else {
                return value
            }
        })
    }
}
