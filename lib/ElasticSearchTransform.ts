import * as _ from "lodash"

class Searchable {
    barcode: string[]
    id: string[]
    name: string[]

    constructor(product: any) {
        this.barcode = []
        this.id = []
        this.name = []

        this.addBarcodesFrom(product)
        this.addIdsFrom(product)
        this.addNamesFrom(product)
    }

    addBarcodesFrom(product: any) {
        if (!_.isNil(product.barcode) && typeof product.barcode === "string") {
            this.barcode.push(product.barcode)
        }
        if (!_.isNil(product.variants) && Array.isArray(product.variant)) {
            for (const variant of product.variants) {
                if (!_.isNil(variant.barcode) && typeof variant.barcode === "string") {
                    this.barcode.push(variant.barcode)
                }
            }
        }
    }
    
    addIdsFrom(product: any) {
        if (!_.isNil(product.id) && typeof product.id === "string") {
            this.id.push(product.id)
        }
        if (!_.isNil(product.variants) && Array.isArray(product.variant)) {
            for (const variant of product.variants) {
                if (!_.isNil(variant.id) && typeof variant.id === "string") {
                    this.id.push(variant.id)
                }
            }
        }
    }

    addNamesFrom(product: any) {
        const candidates: any[] = []
        if (!_.isNil(product.name)) {
            candidates.push(product.name)
        }
        if (!_.isNil(product.variants) && Array.isArray(product.variant)) {
            for (const variant of product.variants) {
                if (!_.isNil(variant.name)) {
                    candidates.push(variant.name)
                }
            }
        }
        if (!_.isNil(product.dimensions) && Array.isArray(product.dimensions)) {
            for (const dimension of product.dimensions) {
                if (!_.isNil(dimension.name)) {
                    candidates.push(dimension.name)
                }
            }
        }
        candidates.forEach((candidate: any) => {
            if (typeof candidate === "string") {
                this.name.push(candidate)
            } else if (typeof candidate === "object") {
                Object.values(candidate).forEach((value: any) => {
                    if (typeof value === "string") {
                        this.name.push(value)
                    }
                })
            }
        })
    }

    validate() {
        if (_.isNil(this.barcode)) {
            throw new Error("Missing barcode array")
        }
        if (!Array.isArray(this.barcode)) {
            throw new Error("barcode not an array")
        }
        if (_.isNil(this.id)) {
            throw new Error("Missing id array")
        }
        if (!Array.isArray(this.id)) {
            throw new Error("id not an array")
        }
        if (_.isNil(this.name)) {
            throw new Error("Missing name array")
        }
        if (!Array.isArray(this.name)) {
            throw new Error("name not an array")
        }
    }

    toJSON(): any {
        return {
            barcode: this.barcode,
            id: this.id,
            name: this.name
        }
    }
}

class Source {
    account: string
    markets?: string[]
    shop?: string

    constructor(source: any) {
        if (_.isNil(source)) {
            throw new Error("Source is nil")
        }
        if (_.isNil(source.account) || typeof source.account !== "string") {
            throw new Error(`source.account is invalid: ${source.account}`)
        }
        if (!_.isNil(source.shop) && typeof source.shop !== "string") {
            throw new Error(`source.shop is invalid: ${source.shop}`)
        }
        if (!_.isNil(source.markets) && !Array.isArray(source.markets)) {
            throw new Error(`source.markets is invalid: ${source.markets}`)
        }
        this.account = source.account
        this.markets = source.markets
        this.shop = source.shop
    }

    validate() {
        if (_.isNil(this.account)) {
            throw new Error("Missing account")
        }
        if (typeof this.account !== "string") {
            throw new Error("account not a string")
        }
        if (!_.isNil(this.shop) && typeof this.shop !== "string") {
            throw new Error("shop not a string")
        }
    }

    toJSON() {
        const result: any = {
            account: this.account
        }
        if (!_.isNil(this.markets)) {
            result.markets = this.markets
        }
        if (!_.isNil(this.shop)) {
            result.shop = this.shop
        }
        return result
    }
}

export class ElasticSearchProduct {
    id: string
    raw: any
    searchable: Searchable
    source: Source

    constructor(product: any, source: any) {
        this.raw = product
        this.searchable = new Searchable(product)
        this.source = new Source(source)
        this.id = ElasticSearchProduct.createDocumentId(product, this.source)
    }

    static createDocumentId(product: any, source: Source) {
        let result = source.account
        if (!_.isNil(source.shop)) {
            result += `*${source.shop}`
        }
        if (_.isNil(product.id) && typeof product.id !== "string") {
            throw new Error("Product missing id")
        }
        result += `*${product.id}`
        return result
    }
 
    validate() {
        if (_.isNil(this.id)) {
            throw new Error("Missing id")
        }
        if (_.isNil(this.raw)) {
            throw new Error("Missing raw object")
        }
        if (_.isNil(this.searchable)) {
            throw new Error("Missing searchable object")
        }
        if (_.isNil(this.source)) {
            throw new Error("Missing source object")
        }
        this.searchable.validate()
        this.source.validate()
    }

    toJSON(): any {
        return {
            id: this.id,
            raw: this.raw,
            searchable: this.searchable.toJSON(),
            source: this.source.toJSON()
        }
    }
}

export class ElasticSearchTransform {
    configuration: any
    data: any
    source: any

    // {
    //     "event": "update",
    //     "id": "abc",
    //     "product": {
    //         "id": "abc",
    //         "name": "My Product",
    //         "retail_price": 10
    //     },
    //     "shop": "shop"
    // }

    constructor(data: any, source: any) {
        this.data = data
        this.source = source

        if (_.isNil(this.data)) {
            throw new Error("Data missing")
        }
        if (_.isNil(this.source)) {
            throw new Error("Source missing")
        }

        if (this.data.event === "delete") {
            if (_.isNil(this.data.id)) {
                throw new Error("id missing for delete event")
            }
        } else {
            if (_.isNil(this.data.product)) {
                throw new Error(`Product missing for ${this.data.event} event`)
            }
        }
    }

    exportProduct(): any {
        if (this.data.event === "delete") {
            return { 
                id: ElasticSearchProduct.createDocumentId({ id: this.data.id }, this.source)
            }
        } else {
            const elastic = new ElasticSearchProduct(this.data.product, this.source)
            elastic.validate()
            return elastic.toJSON()
        }
    }

    static getDocumentId(payload: any): string | undefined {
        return payload.id
    }
}