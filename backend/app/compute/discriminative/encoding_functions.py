from pm4py.algo.filtering.log.variants import variants_filter
import pandas as pd
import pm4py
from .utils import read_json_file, save_json_file



def combine_models(json_content_P,json_content_M,mapping):

# cp = {(x["template"],x["parameters"]) for x in json_content_P["constraints"]}
    c = set()
    for x in json_content_P["constraints"]:
        if len(x["parameters"])>1:
            c.add((x["template"], x["parameters"][0][0],x["parameters"][1][0]))
        else:
            c.add((x["template"], x["parameters"][0][0]))
    for x in json_content_M["constraints"]:
        if len(x["parameters"])>1:
            c.add((x["template"], x["parameters"][0][0],x["parameters"][1][0]))
        else:
            c.add((x["template"], x["parameters"][0][0]))
    json_content = {}
    json_content["name"] = "merged_PN"
    json_content["tasks"] = list(set(json_content_P["tasks"]).union(set(json_content_M["tasks"])))
    json_content["constraints"] = []
    for const in c:
        dict = {"template":const[0], "parameters":[[x] for x in const[1:]]}
        json_content["constraints"].append(dict)


    const_filtered = []
    for c in json_content['constraints']:
        if c['template'] in mapping.keys():
            new_c = c
            new_c['template'] = mapping[c['template']]
            const_filtered.append(new_c)

    json_content['constraints'] = const_filtered

    return json_content


def re_write_model(json_content_P,mapping,path,sup,conf):
# cp = {(x["template"],x["parameters"]) for x in json_content_P["constraints"]}
    c = set()
    for x in json_content_P["constraints"]:
        if len(x["parameters"])>1:
            if x["support"]>=sup and x["confidence"]>=conf:
                c.add((x["template"], x["parameters"][0][0],x["parameters"][1][0]))
        else:
            if x["support"] >= sup and x["confidence"] >= conf:
                c.add((x["template"], x["parameters"][0][0]))
    json_content = {}
    json_content["name"] = "merged_PN"
    json_content["tasks"] = list(set(json_content_P["tasks"]))
    json_content["constraints"] = []
    for const in c:
        dict = {"template":const[0], "parameters":[[x] for x in const[1:]]}
        json_content["constraints"].append(dict)

    co_exist_list = []
    not_co_exist_list = []
    const_filtered = []
    for c in json_content['constraints']:
        if c['template'] in mapping.keys():
            new_c = c
            if c['template'] == 'CoExistence':
                co_exist_list.append((c['parameters'][0][0],c['parameters'][1][0]))
                if (c['parameters'][1][0],c['parameters'][0][0]) in co_exist_list:
                    continue
            elif c['template'] == 'NotCoExistence':
                not_co_exist_list.append((c['parameters'][0][0], c['parameters'][1][0]))
                if (c['parameters'][1][0], c['parameters'][0][0]) in not_co_exist_list:
                    continue
            new_c['template'] = mapping[c['template']]
            const_filtered.append(new_c)

    json_content['constraints'] = const_filtered

    save_json_file(json_content,path)
    return json_content




def extract_trace_variants(xes_file_path):
    """
    Reads an XES event log file and extracts trace variants using pm4py.

    Parameters:
        xes_file_path (str): Path to the XES file.

    Returns:
        dict: A dictionary where keys are trace variants and values are their frequencies.
    """
    # Import the XES event log
    log = pm4py.read_xes(xes_file_path, variant="rustxes")

    # Extract trace variants and their frequencies
    variants = variants_filter.get_variants(log)

    activity_list = {act for var in variants for act in var}
    # Count frequencies of each variant
    variant_counts = {"\u003c" + ",".join(variant) +"\u003e": len(instances) for variant, instances in variants.items()}

    return variant_counts,activity_list


def encode(trace_variants, data):
    """Build the per-variant feature frame from Declare verdicts.

    ``data`` maps each trace variant to ``{constraint_key: verdict}`` where verdict is
    one of ``"satisfied"`` / ``"violated"`` / ``"v_satisfied"`` (as produced by
    ``prolysis.declare.evaluate_log``, a drop-in replacement for the reduced Janus
    ``[eventsEvaluation]`` output). Rows are repeated by variant frequency.
    """
    df = pd.DataFrame(data).T
    # ``prepare_data`` drops a "MODEL" column; keep emitting it (content is unused).
    df["MODEL"] = 0
    df_count = pd.Series(trace_variants).reindex(df.index)
    repeated_indices = df.index.repeat(df_count)
    result = df.loc[repeated_indices].reset_index()
    return result









