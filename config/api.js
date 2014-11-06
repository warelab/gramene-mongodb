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
      l: {
        type: "string",
        pattern: '^[^:]+:[^:]+:[0-9]+:[0-9]+$',
        description: "query location"
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