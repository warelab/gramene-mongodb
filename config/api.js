exports.api = {
  describe: {
    description: "describe a collection"
  },
  select : {
    description : "search interface",
    properties : {
      q: {
        type: "string",
        description: "query string"
      },
      rows: {
        type: "integer",
        description: "number of rows to return"
      },
      start: {
        type: "integer",
        description: "return documents starting at row"
      },
      fl: {
        type: "string",
        description: "list of fields to return"
      },
      sort: {
        type: "string",
        description: "sort criteria"
      },
      hist: {
        type: "string",
        description: "save history"
      }
    }
  },
  facet : {
    description: "field facet counting",
    properties: {
      q: {
        type: "string",
        description: "query string"
      },
      field: {
        type: "string",
        description: "field to count values",
        required: "true"
      }
    }
  }
};