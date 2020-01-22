"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
class Searchable {
    constructor(product) {
        this.barcode = [];
        this.description = [];
        this.id = [];
        this.name = [];
        this.addBarcodesFrom(product);
        this.addDescriptionFrom(product, ["description", "short_description"]);
        this.addIdsFrom(product);
        this.addNamesFrom(product);
    }
    addBarcodesFrom(product) {
        if (!_.isNil(product.barcode) && typeof product.barcode === "string") {
            this.barcode.push(product.barcode);
        }
        if (!_.isNil(product.variants) && Array.isArray(product.variant)) {
            for (const variant of product.variants) {
                if (!_.isNil(variant.barcode) && typeof variant.barcode === "string") {
                    this.barcode.push(variant.barcode);
                }
            }
        }
    }
    addDescriptionFrom(product, descriptionKeys) {
        for (const key of descriptionKeys) {
            if (_.isNil(product[key])) {
                continue;
            }
            if (typeof product[key] === "string") {
                this.description.push(product[key]);
            }
            else if (typeof product[key] === "object") {
                Object.values(product[key]).forEach((value) => {
                    if (typeof value === "string") {
                        this.description.push(value);
                    }
                });
            }
        }
    }
    addIdsFrom(product) {
        if (!_.isNil(product.id) && typeof product.id === "string") {
            this.id.push(product.id);
        }
        if (!_.isNil(product.variants) && Array.isArray(product.variant)) {
            for (const variant of product.variants) {
                if (!_.isNil(variant.id) && typeof variant.id === "string") {
                    this.id.push(variant.id);
                }
            }
        }
    }
    addNamesFrom(product) {
        const candidates = [];
        if (!_.isNil(product.name)) {
            candidates.push(product.name);
        }
        if (!_.isNil(product.variants) && Array.isArray(product.variant)) {
            for (const variant of product.variants) {
                if (!_.isNil(variant.name)) {
                    candidates.push(variant.name);
                }
            }
        }
        if (!_.isNil(product.dimensions) && Array.isArray(product.dimensions)) {
            for (const dimension of product.dimensions) {
                if (!_.isNil(dimension.name)) {
                    candidates.push(dimension.name);
                }
            }
        }
        candidates.forEach((candidate) => {
            if (typeof candidate === "string") {
                this.name.push(candidate);
            }
            else if (typeof candidate === "object") {
                Object.values(candidate).forEach((value) => {
                    if (typeof value === "string") {
                        this.name.push(value);
                    }
                });
            }
        });
    }
    validate() {
        if (_.isNil(this.barcode)) {
            throw new Error("Missing barcode array");
        }
        if (!Array.isArray(this.barcode)) {
            throw new Error("barcode not an array");
        }
        if (_.isNil(this.description)) {
            throw new Error("Missing description array");
        }
        if (!Array.isArray(this.description)) {
            throw new Error("description not an array");
        }
        if (_.isNil(this.id)) {
            throw new Error("Missing id array");
        }
        if (!Array.isArray(this.id)) {
            throw new Error("id not an array");
        }
        if (_.isNil(this.name)) {
            throw new Error("Missing name array");
        }
        if (!Array.isArray(this.name)) {
            throw new Error("name not an array");
        }
    }
    toJSON() {
        return {
            barcode: this.barcode,
            description: this.description,
            id: this.id,
            name: this.name
        };
    }
}
class Source {
    constructor(source) {
        if (_.isNil(source)) {
            throw new Error("Source is nil");
        }
        if (_.isNil(source.account) || typeof source.account !== "string") {
            throw new Error(`source.account is invalid: ${source.account}`);
        }
        if (!_.isNil(source.shop) && typeof source.shop !== "string") {
            throw new Error(`source.shop is invalid: ${source.shop}`);
        }
        if (!_.isNil(source.markets) && !Array.isArray(source.markets)) {
            throw new Error(`source.markets is invalid: ${source.markets}`);
        }
        this.account = source.account;
        this.markets = source.markets;
        this.shop = source.shop;
    }
    validate() {
        if (_.isNil(this.account)) {
            throw new Error("Missing account");
        }
        if (typeof this.account !== "string") {
            throw new Error("account not a string");
        }
        if (!_.isNil(this.shop) && typeof this.shop !== "string") {
            throw new Error("shop not a string");
        }
    }
    toJSON() {
        const result = {
            account: this.account
        };
        if (!_.isNil(this.markets)) {
            result.markets = this.markets;
        }
        if (!_.isNil(this.shop)) {
            result.shop = this.shop;
        }
        return result;
    }
}
class ElasticSearchProduct {
    constructor(product, source) {
        this.raw = product;
        this.searchable = new Searchable(product);
        this.source = new Source(source);
        this.id = this.createDocumentId(product, this.source);
    }
    createDocumentId(product, source) {
        let result = this.source.account;
        if (!_.isNil(this.source.shop)) {
            result += `*${this.source.shop}`;
        }
        if (_.isNil(product.id) && typeof product.id !== "string") {
            throw new Error("Product missing id");
        }
        result += `*${product.id}`;
        return result;
    }
    validate() {
        if (_.isNil(this.id)) {
            throw new Error("Missing id");
        }
        if (_.isNil(this.raw)) {
            throw new Error("Missing raw object");
        }
        if (_.isNil(this.searchable)) {
            throw new Error("Missing searchable object");
        }
        if (_.isNil(this.source)) {
            throw new Error("Missing source object");
        }
        this.searchable.validate();
        this.source.validate();
    }
    toJSON() {
        return {
            id: this.id,
            raw: this.raw,
            searchable: this.searchable.toJSON(),
            source: this.source.toJSON()
        };
    }
}
exports.ElasticSearchProduct = ElasticSearchProduct;
class ElasticSearchTransform {
    constructor(configuration, data, source) {
        this.configuration = configuration;
        this.data = data;
        this.source = source;
    }
    exportProduct() {
        const elastic = new ElasticSearchProduct(this.data.product, this.source);
        elastic.validate();
        return elastic.toJSON();
    }
    getDocumentId(payload) {
        return payload.id;
    }
}
exports.ElasticSearchTransform = ElasticSearchTransform;
//# sourceMappingURL=ElasticSearchTransform.js.map